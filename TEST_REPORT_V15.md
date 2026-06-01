# Test report V15

## Contrôles réalisés localement

- `node --check` exécuté sur tous les fichiers JS du projet.
- Vérification que `roles.js` ne crée plus de rôles uniquement en mémoire locale : création/modification/suppression passent par `DB.saveRole` / `DB.deleteRole`.
- Vérification que `supabase.js` contient les méthodes : `DB.getRoles`, `DB.saveRole`, `DB.deleteRole`.
- Vérification que les anciens rôles `1`, `2`, `3`, `admin`, `manager`, `operator` sont convertis vers des UUID stables.
- Vérification que les sélecteurs de visibilité de formulaires acceptent des IDs de rôles UUID entre guillemets, et plus des nombres JavaScript.

## Limite du test local

Je ne peux pas exécuter Supabase depuis le conteneur. Le SQL fourni est donc idempotent et prévu pour être lancé côté Supabase afin d'aligner la base.

## Fichier SQL à lancer

`supabase/sql/PICOTRACK_V15_ROLES_CLEAN.sql`
