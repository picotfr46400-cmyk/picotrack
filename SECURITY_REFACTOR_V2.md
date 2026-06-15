# PicoTrack — Sécurisation V2

## Changements appliqués

- `/api/data` est désormais désactivé en HTTP 410.
- Le front n’appelle plus `/api/data`.
- Ajout de `/api/records`, une passerelle serveur plus stricte :
  - authentification obligatoire ;
  - aucune `SERVICE_ROLE_KEY` utilisée ;
  - liste blanche de ressources ;
  - méthodes limitées ;
  - paramètres dangereux refusés ;
  - headers venant du navigateur non relayés.
- Le Service Worker a été renommé pour forcer la purge de l’ancien cache.

## Important

Cette version supprime le proxy Supabase générique critique. Elle reste une étape de transition car l’application actuelle est une app statique avec un gros bundle JS. La cible premium finale reste une vraie API métier par domaine : `/api/forms`, `/api/services`, `/api/submissions`, `/api/workflows`, `/api/users`, `/api/pdf`, `/api/mail`.
