# PicoTrack — correctifs sécurité appliqués

## Objectif
Réduire fortement le backend visible ou pilotable depuis le navigateur sans changer de socle GitHub/Vercel.

## Correctifs appliqués

### 1. `/api/data.js`
- Suppression de l'utilisation de la clé `SERVICE_ROLE_KEY` pour les requêtes pilotées par le navigateur.
- Authentification obligatoire par JWT Supabase.
- Requêtes limitées à une liste blanche de tables PicoTrack.
- Méthodes limitées à `GET`, `POST`, `PATCH`, `PUT`, `DELETE`.
- Blocage des URL externes, chemins absolus et traversées `..`.
- En-têtes entrants filtrés.

### 2. `/api/function.js`
- `invite-user` et `delete-user` protégés par un contrôle administrateur serveur.
- Les fonctions génériques nécessitent maintenant une session authentifiée.
- Les appels aux Edge Functions n'utilisent plus la service role pour les requêtes utilisateur standard.

### 3. `/api/send-mail.js`
- Authentification obligatoire.
- Clé Resend maintenue exclusivement côté serveur.
- Validation des emails, sujet, contenu et pièces jointes.
- Limitation du nombre et de la taille des pièces jointes.
- Template mail PicoTrack conservé.

### 4. `/api/tunnel.js`
- Tunnel Supabase désactivé en production.
- L'endpoint retourne maintenant `410 Gone`.
- Objectif : empêcher un proxy Supabase trop large depuis le navigateur.

### 5. `assets/app.76b44b2cee47.js`
- L'appel `/api/send-mail` ajoute maintenant le token Supabase dans l'en-tête `Authorization`.

### 6. `_server-supabase.js`
- Ajout d'une couche serveur commune : CORS contrôlé, lecture body JSON, extraction bearer token, vérification utilisateur Supabase, vérification admin serveur.

## Points restant à traiter dans une vraie V2
Ces correctifs sécurisent l'existant, mais le front contient encore beaucoup de logique métier visible. La prochaine étape propre est de remplacer progressivement les appels génériques `/api/data` par des endpoints métiers dédiés :

- `/api/forms/list`
- `/api/forms/save`
- `/api/submissions/create`
- `/api/services/save`
- `/api/pdf/generate`
- `/api/automations/run`
- `/api/admin/users`

Cela réduira encore plus ce qui est compréhensible dans l'inspecteur.
