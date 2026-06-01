# PicoTrack V9 — Auth Supabase propre

## Ce qui a été corrigé

- Le formulaire utilisateur ne demande plus d'identifiant ni de mot de passe.
- La création d'un utilisateur envoie uniquement une invitation Supabase par e-mail.
- Le mot de passe est choisi par l'utilisateur via Supabase Auth.
- La modification d'un utilisateur ne peut plus supprimer/recréer le compte Auth.
- Les quotas licences sont enregistrés dans `environment_license_limits`, par environnement.
- Le type de licence est stocké dans `license_type`.
- La suppression définitive passe par l'Edge Function `delete-user`.

## À faire côté Supabase

1. SQL Editor : lancer `supabase/sql/PICOTRACK_SCHEMA_PATCH.sql`
2. Edge Functions : déployer `invite-user` avec `supabase/functions/invite-user/index.ts`
3. Edge Functions : déployer `delete-user` avec `supabase/functions/delete-user/index.ts`
4. Secrets Edge Functions :

```txt
URL = https://jcanufkmcslxwmheqccp.supabase.co
ANON_KEY = clé anon / publishable
SERVICE_ROLE_KEY = clé service_role
```

5. Authentication > URL Configuration :

```txt
Site URL = https://picotrack.vercel.app
Redirect URLs = https://picotrack.vercel.app/*
```

## Important

Ne mets plus de champ mot de passe dans PicoTrack pour les comptes supervision/PAD. Supabase Auth gère la création du mot de passe via le mail d'invitation.
