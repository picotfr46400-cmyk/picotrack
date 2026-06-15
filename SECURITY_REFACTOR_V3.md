# PicoTrack Security Refactor V3

## Changements appliqués

- `/api/records` n'accepte plus `path`, `resource` ou `method` venant du navigateur.
- Le proxy REST générique est désactivé côté serveur.
- Le front envoie désormais des actions contrôlées : `health`, `current_profile`, `initial_load`, `list`, `save`, `delete`.
- Le chargement initial des données passe par une action métier unique `initial_load`.
- Les requêtes restent exécutées avec le JWT utilisateur + clé anon Supabase, pas avec la service role key.
- Les entités accessibles sont limitées par liste blanche côté serveur.

## Limite restante

Cette version sécurise fortement la forme des appels réseau. Le gros bundle front contient encore de la logique applicative historique. La prochaine étape propre serait une migration progressive vers une vraie application Next.js avec endpoints métier dédiés par domaine.
