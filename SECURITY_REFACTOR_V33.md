# PicoTrack V33 - Licence mono-appareil

Correction ajoutée :

- création d'une table serveur `active_device_sessions` ;
- à chaque connexion client, l'ancienne session active du même utilisateur/licence/environnement est révoquée ;
- les appels API clients doivent présenter le jeton de session appareil actif ;
- si le même compte se connecte ailleurs, l'ancien appareil reçoit une erreur 409 et est déconnecté ;
- les comptes plateforme / GLOBAL / super_admin ne sont pas limités par cette règle.

Fichiers modifiés :

- `api/_server-supabase.js`
- `api/auth.js`
- `api/function.js`
- `assets/app.secured-v33.js`
- `public/assets/app.secured-v33.js`
- `index.html`
- `public/index.html`
- `sql/20260617_single_device_sessions.sql`
