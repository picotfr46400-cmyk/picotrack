# PicoTrack Security Refactor V8

## Correctif principal

Correction de la persistance des formulaires créés dans le Form Builder.

La table Supabase `forms` utilise le schéma historique suivant :

- `nom`
- `description`
- `couleur`
- `actif`
- `modules`
- `fields`
- `visible_roles`
- `triggers`
- `version`
- `published`
- `tenant_id`
- `environment_code`

Le front peut manipuler certains champs en anglais (`name`, `color`, `active`).
L'API `/api/records` mappe maintenant correctement :

- `name` / `label` → `nom`
- `color` → `couleur`
- `active` → `actif`

## Sécurité conservée

- Pas de retour au proxy générique `/api/data`.
- `/api/records` reste action-based.
- Les colonnes non autorisées sont toujours filtrées.
- Supabase reste appelé côté serveur avec le JWT utilisateur.

## Test attendu

1. Créer un formulaire dans Form Builder.
2. Vérifier qu'une ligne apparaît dans Supabase > table `forms`.
3. Actualiser l'application.
4. Le formulaire doit rester visible.
5. Saisir une donnée via le formulaire.
6. Vérifier qu'une ligne apparaît dans `submissions`.
