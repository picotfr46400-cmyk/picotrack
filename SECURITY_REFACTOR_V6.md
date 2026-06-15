# PicoTrack Security Refactor V6

Corrections ciblées après test V5 :

- Alignement de `app_roles` avec la vraie structure Supabase : colonne `name` au lieu de `nom`, `description` au lieu de `desc`.
- Mapping serveur sécurisé dans `/api/records` pour éviter les erreurs de colonnes côté Supabase.
- Correction du tri des rôles : `name.asc`.
- Endpoint `/api/send-mail` retourne maintenant un statut sain en GET pour éviter les erreurs de probe navigateur, tout en gardant l’envoi réel en POST authentifié.
- Renommage du bundle en `app.secured-v6.js` pour casser le cache.
- Bump Service Worker.

Supabase reste utilisé côté serveur via les API sécurisées.
