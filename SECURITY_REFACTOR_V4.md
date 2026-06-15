# PicoTrack Security Refactor V4

## Corrections réalisées

- Correction du flux de connexion : le profil utilisateur n'est plus récupéré via `/api/data` ni par une requête table construite côté navigateur.
- Ajout de l'action serveur `currentProfile` dans `/api/auth`.
- `/api/auth` vérifie le JWT Supabase puis lit le profil côté serveur.
- Conservation de Supabase comme base de données et système d'authentification.
- Renommage du bundle en `/assets/app.secured-v4.js` pour casser le cache navigateur / Service Worker.
- Mise à jour du Service Worker pour forcer la purge des anciens caches.

## Architecture conservée

Navigateur → API Vercel sécurisées → Supabase

Supabase reste donc bien connecté. La différence est que le navigateur ne doit plus piloter directement les tables sensibles.
