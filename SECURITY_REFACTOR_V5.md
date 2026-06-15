# PicoTrack Security Refactor V5

Corrections appliquées :

- Restauration d’un adaptateur `DB` côté front sans accès Supabase direct.
- Les pages Utilisateurs, Licences et Rôles utilisent toujours Supabase via `/api/records` et `/api/function`.
- Correction de l’erreur `DB is not defined`.
- Conservation de `/api/data` désactivé.
- Renommage du bundle en `app.secured-v5.js` pour casser le cache navigateur/service worker.

Validation :

- `node --check` OK sur le bundle JS.
- Aucun appel navigateur direct à `/api/data` dans le bundle.
- ZIP recréé et contrôlé.
