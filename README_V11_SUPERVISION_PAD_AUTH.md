# PicoTrack V11 - Supervision / PAD propre

## Ce qui change

- Supervision PC : invitation e-mail Supabase Auth. L’administrateur ne choisit ni identifiant ni mot de passe. L’utilisateur clique sur le lien reçu et crée son mot de passe.
- PAD Terrain : identifiant + mot de passe définis par l’administrateur. Aucun compte Supabase Auth n’est créé.
- Les rôles sont normalisés en base : `admin`, `manager`, `operator`, `pad_user`.
- Les anciens rôles numériques 1/2/3 ne sont plus enregistrés.
- Les quotas sont lus/écrits dans `environment_license_limits` sans revenir à 3 par défaut.

## À faire côté Supabase

1. SQL Editor : exécuter `supabase/sql/PICOTRACK_SCHEMA_PATCH.sql`.
2. Edge Functions : redéployer `invite-user` avec `supabase/functions/invite-user/index.ts`.
3. Edge Functions : redéployer `delete-user` avec `supabase/functions/delete-user/index.ts`.
4. Secrets Edge Functions : vérifier `URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`.
5. Authentication > URL Configuration : Site URL = `https://picotrack.vercel.app`, Redirect URLs = `https://picotrack.vercel.app/*`.
