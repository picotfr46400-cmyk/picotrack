# Architecture PicoTrack

## Données et isolation des clients

Chaque client PicoTrack a son propre projet Supabase dédié, servi sur son propre sous-domaine (par exemple `efc.picotrack.fr` pour EFC), avec ses propres clés (URL, clé anon, service role) posées côté hôte. EFC conserve son projet actuel.

Aucune base n’est jamais partagée entre clients. Un nouveau client, c’est un nouveau projet Supabase et de nouvelles clés côté hôte, jamais un nouvel `environment_code` dans une base existante. Toute pull request qui mutualise une base entre clients est refusée en revue.

Les filtres `environment_code` et les listes blanches côté serveur dans `api/` ne sont qu’une défense en profondeur à l’intérieur de la base d’un client. Ce n’est pas un modèle multi-clients.

Argument de vente : les données de chaque client sont cloisonnées et ne se mélangent jamais avec celles d’un autre client.

Cette règle n’est pas encore appliquée techniquement dans le code. Un garde-fou est prévu : refuser deux clients non-EFC sur le même projet Supabase ou avec des clés identiques, et cesser de créer des comptes pour un `environment_code` arbitraire.

## Traçabilité et conservation

Le journal `submission_audit_log` est en ajout seul. Ni le code ni cette documentation ne fixent de durée de conservation pour les saisies elles-mêmes. Le journal suit donc la même durée, par défaut **3 ans**, à confirmer par le client.

Le balayage par durée n’est pas appelé par l’application. Un opérateur l’exécute avec la clé `service_role` :

```sql
select public.purge_submission_audit_log(interval '3 years', 'CODE_ENVIRONNEMENT');
```

Ce balayage ne supprime que les lignes de cet `environment_code`.

La suppression d’une saisie (ou des saisies d’un formulaire supprimé) efface aussi les données personnelles de son journal. Le serveur appelle la même fonction, toujours en `service_role`, avec la saisie ciblée. C’est le seul chemin qui peut modifier ou supprimer le journal : le trigger d’ajout seul ne laisse passer l’opération que le temps de cet appel. Les valeurs des champs ne sont pas recopiées dans l’événement de suppression.

## Idempotence des créations PAD

Une création (`form_submission` ou `service_instance`) n’ouvre pas de réservation sans id. `submissions` et `service_instances` portent `idempotency_key`, insérée dans le même `INSERT ... ON CONFLICT DO NOTHING`. L’index unique `(environment_code, idempotency_key)` est plein, sans `WHERE`, et les NULL restent distincts : les lignes déjà en base ne sont pas réécrites. En cas de conflit, le serveur relit l’id existant et renvoie le résultat d’origine. La saisie et sa clé existent ensemble, ou pas du tout.

La tablette crée l’`idempotency_key` une seule fois, un UUID v4, au moment où la saisie naît, avant le premier envoi. Elle est stockée avec l’élément de la file et réutilisée à chaque renvoi, y compris après rechargement. Toute saisie PAD, en ligne ou depuis la file, part vers `/api/pad-sync`. L’ancien enregistrement `records` d’une saisie `device=pad` appelle la même insertion atomique. Un élément déjà en file sans clé est accepté : le serveur dérive une clé stable, hash de la licence, du formulaire, de l’id local ou de la date client, et du contenu canonisé, puis journalise un avertissement. Une saisie PAD n’est plus écrite avec une clé NULL.

Les trois migrations `supabase/migrations/20261008221500_submission_audit_log.sql`, `supabase/migrations/20261008233000_submission_audit_idempotence_purge.sql` et `supabase/migrations/20261008234500_business_idempotency_key.sql` s’appliquent avant le déploiement du code. Sinon `pad-sync` répond 503.

Une échéance unique de 10 s part du début de la requête. Avant chaque appel (lecture de la licence, insert, relecture de l’id, journal, et la mise à jour `last_seen`), le temps restant est recalculé et passé comme délai d’abandon. En dessous de 50 ms, l’appel n’est pas lancé. L’action en cours, ou pas encore commencée, revient `retry` avec la même clé.

`pad_sync_receipts` ne sert qu’aux actions qui ne créent aucune saisie (transition, modification). La file tablette actuelle n’en envoie pas : seulement `form_submission` et `service_instance`. Pour une telle action, si elle existe un jour, la réservation `pending` expire au bout d’environ 60 secondes. La complétion et la libération ont leur propre délai de 2 s, séparé du journal. Une action ne sort du lot en cours qu’une fois le reçu réellement complété ou libéré. Une complétion qui échoue ne marque pas la requête comme dégradée.

Le journal garde son budget de 3 s (un seul POST groupé, 2 s pour cet appel), plafonné par le temps restant avant l’échéance de 10 s. Ce budget ne borne pas la création des saisies. Si le journal ne tient pas dans ce qui reste alors que la saisie est déjà enregistrée, l’action revient aussi `retry` : le client `pt_pad_offline_queue_v17` ne la marque pas `synced`. Le renvoi répond 200 avec le même id et complète le journal sans doublon, sur la clé `pad:<action>:<événement>`. Un 503 en milieu de lot ne marque `synced` que les actions renvoyées `applied`. Les autres restent en file (`error`) et le flush les renvoie, avec la même clé. Ce renvoi ne crée pas de doublon.

Le mode tolérant de `claimPadAction` ne sert que pendant la fenêtre de déploiement, tant que la migration `supabase/migrations/20261008233000_submission_audit_idempotence_purge.sql` n’est pas appliquée et que la table `pad_sync_receipts` est donc absente, et seulement pour une action sans création. La synchro de ces actions continue alors sans dédoublonnage des reçus. Ce mode disparaît une fois la migration appliquée.

Chaque passage de ce mode écrit un `console.warn` dont le préfixe stable est `[pad-sync] receipts table missing, idempotence degraded`, suivi du code d’erreur (`42P01`, `PGRST205` ou `404`). Pour vérifier que le mode a disparu : zéro occurrence de ce préfixe dans les logs.

Un délai dépassé ou une erreur 5xx de la table de reçus n’est pas une table absente. Ces cas restent tolérés pour la réservation, avec un préfixe distinct : `[pad-sync] receipts timeout or 5xx, idempotence degraded`, suivi du code HTTP. Après le premier délai ou 5xx, le reste des réservations passe en mode dégradé sans nouvel appel, et un seul avertissement est écrit. Ce budget n’est pas celui du journal, et il ne s’applique pas aux créations.

Une erreur de synchronisation répond 503 (401 seulement si la session ou la licence est refusée) avec un message générique et un `request_id`. Le détail, y compris le message Postgres, ne part pas au client : il est écrit dans les logs serveur avec le même `request_id`.
## Mails automatiques

Les saisies (y compris une tablette hors ligne, au moment de la synchronisation) et les étapes de workflow déclenchent les mails **côté serveur**, après l’écriture réussie. Sur la tablette, le journal est confirmé d’abord, puis le mail utilise le temps restant dans l’échéance de 10 s : il ne fait pas échouer la réponse, et il est sauté s’il reste moins de 50 ms. Le navigateur ne contacte plus le transport : aucune clé Resend ni SMTP n’y est exposée. Il n’y a pas de fonction Vercel supplémentaire (le plafond Hobby reste 12) et pas de cron dédié.

### Transport

`MAIL_TRANSPORT` vaut `smtp` ou `resend`. Sans cette variable, PicoTrack choisit SMTP dès que `SMTP_HOST` et `SMTP_FROM` sont remplis, sinon Resend (`RESEND_API_KEY`, expéditeur `RESEND_FROM`).

Boîte Microsoft 365 déjà payée par le client, sans abonnement Make / Zapier / Resend :

| Variable | Exemple |
| --- | --- |
| `MAIL_TRANSPORT` | `smtp` (ou vide : le choix est automatique) |
| `SMTP_HOST` | `smtp.office365.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | l’adresse de la boîte |
| `SMTP_PASS` | mot de passe d’application ou mot de passe de la boîte si l’authentification SMTP est autorisée |
| `SMTP_FROM` | la même adresse que `SMTP_USER` |

Le port 587 utilise STARTTLS (`requireTLS`, pas de TLS implicite). Gmail se branche de la même façon sur `smtp.gmail.com:587` avec un mot de passe d’application. Côté Microsoft 365, l’authentification SMTP authentifiée doit être activée pour la boîte.

### Limites

- Budget d’envoi : environ 2 s par appel au transporteur et 3 s au total pour la requête de saisie. Le SMTP lui-même est borné à 15 s (connexion, bannière, socket). Le bail de claim dure 120 s, toujours plus longtemps que l’envoi. Au-delà du budget HTTP, la ligne reste `sending`. Le passage à `sent` est conditionné par `attempt_id` : un succès tardif ne peut pas réécrire une ligne déjà sortie de `sending`. Si le bail expire pendant `sending`, `expire_mail_outbox` passe la ligne à `uncertain` sans rendre la place. Cet état n’est jamais renvoyé automatiquement, quel que soit le transport. L’admin affiche « Envoi incertain » et un bouton « Renvoyer ». Le `Message-ID` SMTP est dérivé de l’identifiant de la ligne d’outbox. Resend garde l’en-tête `Idempotency-Key`.
- Toute erreur ou tout timeout après l’envoi de la commande DATA passe la ligne à `uncertain` : pendant le corps, après le point final, ou sans réponse 250. La place reste consommée, il n’y a aucun renvoi automatique, et le renvoi se fait seulement à la main dans l’admin. Le drapeau est posé à l’envoi de DATA, parce que nodemailer remonte souvent `ETIMEDOUT` avec `command=CONN`. Seuls les échecs certains avant DATA passent `failed`, rendent la place et peuvent être renvoyés : connexion, TLS, authentification, MAIL FROM ou RCPT refusés. Un 5xx explicite après le point final passe `failed` sans renvoi automatique.
- `{{lien}}` est produit par le serveur depuis `APP_ORIGIN` (https, `*.picotrack.fr` ou aperçu `picotrack*.vercel.app`, sinon `https://picotrack.fr`) et l’identifiant de la saisie seulement : `/?saisie=<id>`. Il est inséré après le masquage, et l’ouvrir demande une connexion. L’en-tête `Host` et `X-Forwarded-Host` ne sont pas lus.
- 10 destinataires au plus par règle (To, Cc et Cci dédoublonnés). Un enregistrement au-delà répond 400 : « 10 destinataires maximum par règle. » Une règle déjà enregistrée, ou un ancien `triggers.sendMail`, qui en a davantage part aux 10 premiers, la ligne passe `sent` avec l’avertissement « Destinataires limités aux 10 premiers. À réduire à 10 destinataires. »
- Plafonds par environnement, en destinataires : 60 par heure (`MAIL_HOURLY_LIMIT`) et 300 par jour (`MAIL_DAILY_LIMIT`, fuseau Europe/Paris). Le claim et la réservation du compteur (une ligne par environnement et par fenêtre) se font dans la même opération SQL, `claim_mail_quota`. Plafond atteint : la ligne reste `pending`, sans envoi. Une place réservée est rendue seulement pour un échec certain avant DATA, ou pour un 5xx explicite après le point final. Un envoi `uncertain` (bail expiré, ou toute erreur après la commande DATA) garde la place et n’est pas renvoyé automatiquement.
- Tout changement d’état de l’outbox est conditionné par l’identifiant, le statut attendu et `attempt_id`. Zéro ligne touchée : on abandonne, sans écrire ni envoyer. Une ligne `sent`, `sending` ou `uncertain` n’est pas écrasée par un autre envoi. Le renvoi d’une ligne `sent` ou `sending` est refusé. Le renvoi manuel d’un `uncertain` rend d’abord l’ancienne place (`release_uncertain_mail`), puis le claim en prend une nouvelle : une seule place est comptée.
- 3 essais automatiques. `claim_mail_quota` ne reprend que `pending` ou `failed`, pose un `attempt_id` et un bail de 120 s. Il ne reprend jamais un `sending` expiré. L’essai suivant a lieu à la prochaine écriture, pas via un cron. `claim_mail_outbox` reste disponible et ne reprend pas non plus un `sending`.
- Chaque saisie d’un lot qui correspond à une règle a une ligne d’outbox (`pending`, `sent`, `failed` ou `skipped`, avec la raison). Les lignes sont insérées en un seul lot avant les envois. Une synchro tablette rejouée s’appuie sur l’identifiant d’action PAD, pas sur l’identifiant de saisie.
- Les règles et l’outbox sont filtrées par `environment_code`. Seule la supervision autorisée de l’environnement les lit ou les écrit. Une licence PAD, quel que soit son alias, et une licence lecture reçoivent 403. Un environnement vide répond 400, sans repli `DEMO`.
- La file ne stocke que des identifiants. Le masquage unique est `api/_secret-mask.js` : le journal l’appelle, il n’a plus de liste à lui. Les noms sont comparés en forme compacte (sans espace ni ponctuation) : mots de passe, `token`, `apiKey`, `licenseKey`, `authorization`, `bearer`, session, cookie, clés Supabase, code PIN, pin_code, pincode, PIN, digicode, code d’accès, code secret, code confidentiel, code de vérification, clé de licence, numéro de carte, carte bancaire, cryptogramme, CVV et IBAN. Un code client, article, chantier, barre, un contrôle d’accès, « accès », « confidentiel » seul et le code postal restent visibles sur le nom. Les valeurs des mails : JWT ancré, jeton à haute entropie (mot entier, sans `=`), carte Luhn, IBAN ; un UUID `8-4-4-4-12` n’est pas un secret, et `aaaa…` non plus. Le journal reprend en plus la valeur entière (JWT n’importe où dans le texte, hexadécimal d’au moins 32 caractères, jeton d’au moins 32 caractères y compris `=`) et coupe à 500 caractères. Le détail du journal reste limité à 20 Ko. Le remplacement est le mot « masqué ». Si le formulaire ne peut pas être relu, rien n’est envoyé et la ligne reste `pending`.
- Le même masquage s’applique à chaque PDF, pièce jointe du mail et export de saisie. S’il échoue ou dépasse le budget, le mail part sans pièce jointe, avec la mention « PDF indisponible, consultable dans PicoTrack ». La saisie n’est jamais bloquée.
- Les variables de modèle sont `{{formulaire}}`, `{{statut}}`, `{{auteur}}`, `{{date}}` (Europe/Paris), `{{lien}}` (`/?saisie=<id>`, posé après le masquage) et le nom ou la clé de chaque champ. Le masquage ne porte que sur le contenu des formulaires et des utilisateurs. Les valeurs sont échappées en HTML. Un formulaire qui a encore `triggers.sendMail` et aucune règle serveur est traité comme une règle implicite, avec le PDF seulement si `attachPdf` vaut `true`.

### Migration

Appliquer à la main, sur le projet Supabase de chaque client, dans l’ordre des noms de fichiers :

1. Les trois fichiers du journal, déjà sur v2 : `20261008221500_submission_audit_log.sql`, `20261008233000_submission_audit_idempotence_purge.sql`, `20261008234500_business_idempotency_key.sql`.
2. `supabase/migrations/20261009130000_mail_outbox.sql` — tables `mail_rules` puis `mail_outbox`, puis `claim_mail_outbox`, puis `expire_mail_outbox`. Contrainte unique complète sur `idempotency_key` (sans filtre `WHERE`), colonne `attempt_id`, statut `uncertain`, RLS forcée, droits limités à `service_role`. Ce fichier suit `20261009120000_match_short_logins.sql`.
3. `supabase/migrations/20261009140000_mail_quota.sql` — compteur `mail_quota`, `claim_mail_quota` et `finish_mail_outbox`. Même règle : RLS forcée, `service_role` seulement.
4. `supabase/migrations/20261009150000_mail_uncertain_release.sql` — `release_uncertain_mail`, qui rend la place d’un `uncertain` avant le renvoi manuel.

D’abord la démo, jamais EFC depuis ici.

L’application ne lance pas ces migrations.


## Accès par rôle

Les rôles personnalisés vivent dans `app_roles`. Le champ JSON `permissions.access` décrit, pour un rôle, ce qu’il peut voir :

```json
{
  "forms": { "<formId>": "hidden" },
  "services": { "<serviceId>": "read" },
  "statuses": { "<serviceId>": { "<statusId>": "write" } }
}
```

Les niveaux sont `hidden` (masqué), `read` (lecture) et `write` (écriture). L’absence de clé `access`, `null`, ou un objet sans aucune règle (`{}` ou des cartes vides) laisse le défaut historique (`permissions.view`, `permissions.submit`, `permissions.edit`, `permissions.delete`, « Visible par »). Un access vide ne masque pas tout. Le masquage s’applique quand l’objet porte au moins une règle : une ressource absente de cette règle, une valeur illisible ou `hidden` restent masqués. Une chaîne ou un tableau à la place de l’objet est illisible et masque. Entre plusieurs rôles, le plus permissif gagne. Un rôle historique compte comme ce défaut et relève une règle plus stricte. Remettre un niveau à « Par défaut » retire l’entrée ; si plus aucune règle ne reste, la clé `access` est supprimée.

Les rôles de place (`supervision_user`, `pad_user`, `operator`, `admin`, …) ne comptent pas comme un rôle catalogue. Les comptes plateforme ne sont pas concernés par le masquage des données.

Un formulaire sans entrée propre prend le niveau le plus permissif des workflows qui portent une règle explicite. Un workflow sans règle n’ouvre pas le formulaire. Une entrée propre sur ce formulaire gagne sur cet héritage. Le formulaire et le workflow sont relus en base à partir de l’élément visé : omettre ou falsifier un paramètre ne change pas le contrôle. Un élément masqué répond 404, en lecture comme en modification ou en suppression. Un workflow en lecture seule refuse toute saisie, modification ou suppression, y compris depuis la tablette.

Si la lecture des rôles ou des permissions échoue, le serveur répond 503 et refuse. Il n’ouvre pas l’accès par défaut. Personne ne modifie ses propres rôles ou permissions. On n’accorde un rôle qu’avec `manage_users`, et seulement si, pour chaque ressource explicite, le niveau du rôle est inférieur ou égal au niveau effectif de l’auteur (masqué, puis lecture, puis écriture). Il peut donc accorder son propre rôle. Une ressource sans règle n’est pas comptée comme une écriture. Un compte plateforme reste hors de portée. Désactiver ou supprimer un rôle appelle la RPC `role_still_assigned`, réservée à `service_role`. La forme canonique est la fonction SQL immutable `normalize_role_name` : `normalize(NFKC)`, tout espace Unicode (tabulation, espace insécable, `\s` et classe Zs) remplacé par un espace simple, caractères invisibles et de contrôle retirés, puis trim et `lower` collé sur `und-x-icu`. La RPC normalise les deux côtés, `user_profiles.role` / `roles` et `licenses.role` / `roles`. La colonne `roles` est lue quel que soit son type jsonb, via `jsonb_typeof` : tableau, chaîne, texte, CSV ou null. Un rôle attribué répond 409 et rien n’est modifié. Si la vérification échoue, la réponse est 503. À l’écriture, un nom qui contient un caractère de contrôle ou invisible répond 400. Sinon le nom est stocké sous sa forme canonique. `api/_access.js` garde le miroir `normalizeRoleName` pour valider les entrées. Un nom vide répond 400. `app_roles.name` est canonique à la création, unique sous cette forme dans l’environnement. La migration `20261016120000_normalize_role_name.sql`, horodatée après `20261015180000_role_still_assigned.sql`, crée cette fonction. Elle ne réécrit aucune ligne. Elle s’applique sur DEMO, jamais sur EFC. Le contrôle d’accès réunit les rôles du profil et ceux de `licenses.roles` pour la licence active du même e-mail et du même environnement : tableau, chaîne, CSV ou null, lus par `roleTokens`. Un compte sans `manage_users` ne reçoit que son propre rôle et ses permissions. Un compte avec `manage_users` reçoit les rôles de son environnement, sans les rôles plateforme, et sans les formulaires ni les workflows qui lui sont masqués dans le détail des permissions. Si toutes les règles d’un rôle tombent sur des éléments masqués pour ce lecteur, la réponse porte `permissions.access_hidden: true` avec un `access` vide. Ce drapeau n’est pas enregistré. Il distingue ce rôle d’un rôle historique, sans clé `access` ou avec seulement des cartes vides, qui s’affiche comme le défaut. La liste `app_roles` renvoie le catalogue projeté après `offset`, dans la borne de 5 000 rôles. Au-delà, la réponse est 503. La synchro tablette (`pad-sync`) lit seulement les rôles de l’acteur, par nom canonique ou par id, dans son environnement. Si cette lecture échoue ou dépasse la borne de 5 000, la réponse est 503, dans l’échéance de 10 s. Les destinataires d’une règle de courriel sont résolus avec ce même `normalizeRoleName` : colonne `role`, `roles` et `license_roles`. Une demande `limit` ne coupe plus la fin en dessous de cette borne. Le catalogue `roles` du résumé utilisateurs (`action: summary`) est trié par `id` croissant. Les fiches `rows` de ce résumé sont triées par `created_at` décroissant.

Un statut `hidden` rend les dossiers dans ce statut invisibles et interdit d’y faire passer un dossier. Un statut `read` laisse lire le dossier mais interdit de le modifier tant qu’il est dans ce statut. Un service `hidden` plafonne aussi ses statuts. Ce masquage de dossier est un filtre en base, sur la saisie visée ou sur le service et le statut, et non une liste d’instances tenue en mémoire. Une longue liste d’identifiants est envoyée par lots : 81 workflows ouverts ne répondent pas 503. Aucun contrôle d’accès, de suppression ou de quota ne conclut sur une lecture coupée : la requête filtre en base, ou elle est relue jusqu’à la dernière page. Au-delà d’une borne, ou si la lecture échoue, la réponse est 503, jamais un extrait.

Le serveur est la seule autorité. `api/_access.js` est appliqué aux listes, compteurs, recherches, lectures directes (404 si masqué), écritures (403 en lecture seule, 404 si masqué), transitions, export PDF, rendez-vous, frise de traçabilité et synchro tablette (`pad-sync`, qui applique aussi les listes historiques). Les contrôles de droits précèdent l’insertion idempotente. Un refus 403 ou 404 sur une action de la tablette ne coupe pas le reste du lot. `filterTraceRows` retire d’un export ou des `mail_logs` toute ligne dont le formulaire, le workflow ou le statut est masqué, et l’export PDF refuse le dossier avant la frise.

Une licence `lecture` / `readonly` est en lecture seule côté serveur : aucune saisie, aucun workflow, aucune administration. Son quota est la colonne `lecture_limit`, distincte de `supervision_limit`. Il n’existe pas de colonne `readonly_limit`. La gestion des utilisateurs est réservée aux administrateurs d’environnement (`environment_admin`, `admin`, `client_admin`) et aux rôles dont `permissions.manage_users` est vrai. Le rôle système `supervision_user` garde cette permission. Une licence lecture ne l’a jamais. `operator` et `pad` ne l’ont pas. Les clés API et webhooks (`integrations_*`) sont réservés aux administrateurs d’environnement, jamais à une licence pad. Écrire `app_roles` ou `permissions.access` est refusé à tout autre profil. Créer un formulaire sans id vérifie le droit d’édition historique.

Le relevé des colonnes publiques est dans `supabase/schema/public-columns.sql`. Ce n’est pas une migration : il n’est appliqué à aucune base distante. La CI le charge dans un Postgres de service pour les tests de quota, de réactivation et de rôles. Un `select` ou une colonne écrite qui n’y figure pas casse la CI. `services` n’a pas `visible_roles` (`forms` l’a). `licenses` n’a pas de `user_id`.

Aucune migration n’est nécessaire : `permissions` est déjà un JSON. Les écrans (Administration → Rôles & Permissions, studio formulaire, éditeur de workflow et onglet Statuts) sont réservés aux administrateurs d’environnement. L’aperçu « Voir comme ce rôle » est local au navigateur et n’envoie rien au serveur.
