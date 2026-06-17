# SECURITY / USERS REFACTOR V24

Objectif : création directe des utilisateurs PicoTrack, sans invitation e-mail.

Corrections :
- Super admin et admin client peuvent créer des utilisateurs.
- Création directe via Supabase Auth Admin `/auth/v1/admin/users`.
- Mot de passe défini dans PicoTrack à la création.
- Supervision PC : identifiant = e-mail.
- PAD Terrain : identifiant = login PAD, avec e-mail technique interne généré côté frontend/API.
- Le quota est contrôlé côté serveur avant création.
- Si le quota Supervision ou PAD est atteint, l'API bloque la création.
- L'utilisateur est créé uniquement dans l'environnement actif.
- `GLOBAL` reste un niveau plateforme/super_admin, jamais un environnement utilisateur client.
- Login par identifiant non e-mail ajouté côté `/api/auth` via résolution `login_user`/`username`.
- Build bumpé sur `app.secured-v24.js`.

Points de contrôle :
- Créer un utilisateur Supervision PC avec e-mail + mot de passe.
- Créer un utilisateur PAD avec identifiant + mot de passe.
- Vérifier que les deux consomment les quotas de l'environnement actif.
- Vérifier qu'une création au-delà du quota est refusée par le serveur.
