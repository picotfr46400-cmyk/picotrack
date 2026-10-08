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

## Reçus PAD pendant le déploiement

Le mode tolérant de `claimPadAction` ne sert que pendant la fenêtre de déploiement, tant que la migration `supabase/migrations/20261008233000_submission_audit_idempotence_purge.sql` n’est pas appliquée et que la table `pad_sync_receipts` est donc absente. La synchro continue alors sans dédoublonnage des reçus. Ce mode disparaît une fois la migration appliquée.

Chaque passage écrit un `console.warn` dont le préfixe stable est `[pad-sync] receipts table missing, idempotence degraded`, suivi du code d’erreur (`42P01`, `PGRST205` ou `404`). Pour vérifier que le mode a disparu : zéro occurrence de ce préfixe dans les logs.

Un délai dépassé ou une erreur 5xx de la table n’est pas une table absente. Ces cas restent tolérés dans le budget de 2 s de l’appel, mais avec un préfixe distinct : `[pad-sync] receipts timeout or 5xx, idempotence degraded`, suivi du code HTTP.
