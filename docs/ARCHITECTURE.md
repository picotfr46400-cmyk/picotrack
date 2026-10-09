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

## Accès par rôle

Les rôles personnalisés vivent dans `app_roles`. Le champ JSON `permissions.access` décrit, pour un rôle, ce qu’il peut voir :

```json
{
  "forms": { "<formId>": "hidden" },
  "services": { "<serviceId>": "read" },
  "statuses": { "<serviceId>": { "<statusId>": "write" } }
}
```

Les niveaux sont `hidden` (masqué), `read` (lecture) et `write` (écriture). L’absence de clé `access` (absente ou `null`) laisse le défaut historique (`permissions.view`, `permissions.submit`, `permissions.edit`, `permissions.delete`, « Visible par »). Le masquage ne s’applique qu’à un rôle dont l’objet `access` est présent : une ressource sans règle, un objet vide `{}`, une valeur illisible ou `hidden` restent masqués. Entre plusieurs rôles, le plus permissif gagne. Un rôle historique sans clé `access` compte comme ce défaut. Un rôle en lecture plus un rôle dont `access` est vide reste donc en lecture.

Les rôles de place (`supervision_user`, `pad_user`, `operator`, `admin`, …) ne comptent pas comme un rôle catalogue. Les comptes plateforme ne sont pas concernés par le masquage des données.

Un formulaire sans entrée propre prend le niveau le plus permissif des workflows qui portent une règle explicite. Un workflow sans règle n’ouvre pas le formulaire. Une entrée propre sur ce formulaire gagne sur cet héritage. Le formulaire et le workflow sont relus en base à partir de l’élément visé : omettre ou falsifier un paramètre ne change pas le contrôle. Un élément masqué répond 404, en lecture comme en modification ou en suppression. Un workflow en lecture seule refuse toute saisie, modification ou suppression, y compris depuis la tablette.

Si la lecture des rôles ou des permissions échoue, le serveur répond 503 et refuse. Il n’ouvre pas l’accès par défaut. Personne ne modifie ses propres rôles ou permissions. On n’accorde un rôle qu’avec `manage_users`, et seulement si, pour chaque ressource explicite, le niveau du rôle est inférieur ou égal au niveau effectif de l’auteur (masqué, puis lecture, puis écriture). Il peut donc accorder son propre rôle. Une ressource sans règle n’est pas comptée comme une écriture. Un compte plateforme reste hors de portée. Désactiver un rôle encore assigné répond 409, comme sa suppression. Un compte sans `manage_users` ne reçoit que son propre rôle et ses permissions. Un compte avec `manage_users` reçoit les rôles de son environnement, sans les rôles plateforme, et sans les formulaires ni les workflows qui lui sont masqués dans le détail des permissions.

Un statut `hidden` rend les dossiers dans ce statut invisibles et interdit d’y faire passer un dossier. Un statut `read` laisse lire le dossier mais interdit de le modifier tant qu’il est dans ce statut. Un service `hidden` plafonne aussi ses statuts.

Le serveur est la seule autorité. `api/_access.js` est appliqué aux listes, compteurs, recherches, lectures directes (404 si masqué), écritures (403 en lecture seule, 404 si masqué), transitions, export PDF, rendez-vous, frise de traçabilité et synchro tablette (`pad-sync`, qui applique aussi les listes historiques). Les contrôles de droits précèdent l’insertion idempotente. Un refus 403 ou 404 sur une action de la tablette ne coupe pas le reste du lot. `filterTraceRows` retire d’un export ou des `mail_logs` toute ligne dont le formulaire, le workflow ou le statut est masqué, et l’export PDF refuse le dossier avant la frise.

Une licence `lecture` / `readonly` est en lecture seule côté serveur : aucune saisie, aucun workflow, aucune administration. Son quota est la colonne `lecture_limit`, distincte de `supervision_limit`. Il n’existe pas de colonne `readonly_limit`. La gestion des utilisateurs est réservée aux administrateurs d’environnement (`environment_admin`, `admin`, `client_admin`) et aux rôles dont `permissions.manage_users` est vrai. Le rôle système `supervision_user` garde cette permission. Une licence lecture ne l’a jamais. `operator` et `pad` ne l’ont pas. Les clés API et webhooks (`integrations_*`) sont réservés aux administrateurs d’environnement, jamais à une licence pad. Écrire `app_roles` ou `permissions.access` est refusé à tout autre profil. Créer un formulaire sans id vérifie le droit d’édition historique.

Le relevé des colonnes publiques est dans `supabase/schema/public-columns.sql`. Ce n’est pas une migration : il n’est appliqué à aucune base distante. La CI le charge dans un Postgres de service pour les tests de quota, de réactivation et de rôles. Un `select` ou une colonne écrite qui n’y figure pas casse la CI. `services` n’a pas `visible_roles` (`forms` l’a). `licenses` n’a pas de `user_id`.

Aucune migration n’est nécessaire : `permissions` est déjà un JSON. Les écrans (Administration → Rôles & Permissions, studio formulaire, éditeur de workflow et onglet Statuts) sont réservés aux administrateurs d’environnement. L’aperçu « Voir comme ce rôle » est local au navigateur et n’envoie rien au serveur.
