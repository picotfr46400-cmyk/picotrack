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

`pad_sync_receipts` ne sert qu’aux actions qui ne créent aucune saisie (transition, modification). La file tablette actuelle n’en envoie pas : seulement `form_submission` et `service_instance`. Pour une telle action, si elle existe un jour, la réservation `pending` expire au bout d’environ 60 secondes. La complétion et la libération ont leur propre délai de 2 s, séparé du journal. Une action ne sort du lot en cours qu’une fois le reçu réellement complété ou libéré. Une complétion qui échoue ne marque pas la requête comme dégradée.

Le budget d’environ 3 s ne borne que le journal (un seul POST groupé, 2 s pour cet appel). Il ne borne pas la création des saisies. Si la requête atteint 14 s, les actions suivantes ne sont pas commencées. La réponse n’est pas 200 : le client `pt_pad_offline_queue_v17` ne passe une action à `synced` que si l’appel réussit. Sinon elle reste en file (`error`) et le flush la renvoie. Ce renvoi ne crée pas de doublon, grâce à la clé.

Le mode tolérant de `claimPadAction` ne sert que pendant la fenêtre de déploiement, tant que la migration `supabase/migrations/20261008233000_submission_audit_idempotence_purge.sql` n’est pas appliquée et que la table `pad_sync_receipts` est donc absente, et seulement pour une action sans création. La synchro de ces actions continue alors sans dédoublonnage des reçus. Ce mode disparaît une fois la migration appliquée.

Chaque passage de ce mode écrit un `console.warn` dont le préfixe stable est `[pad-sync] receipts table missing, idempotence degraded`, suivi du code d’erreur (`42P01`, `PGRST205` ou `404`). Pour vérifier que le mode a disparu : zéro occurrence de ce préfixe dans les logs.

Un délai dépassé ou une erreur 5xx de la table de reçus n’est pas une table absente. Ces cas restent tolérés pour la réservation, avec un préfixe distinct : `[pad-sync] receipts timeout or 5xx, idempotence degraded`, suivi du code HTTP. Après le premier délai ou 5xx, le reste des réservations passe en mode dégradé sans nouvel appel, et un seul avertissement est écrit. Ce budget n’est pas celui du journal, et il ne s’applique pas aux créations.

Une erreur de synchronisation répond 503 (401 seulement si la session ou la licence est refusée) avec un message générique et un `request_id`. Le détail, y compris le message Postgres, ne part pas au client : il est écrit dans les logs serveur avec le même `request_id`.
