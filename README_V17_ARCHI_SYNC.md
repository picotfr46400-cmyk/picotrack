# PicoTrack V17 — socle sync propre

## Règle d'architecture

- Supabase = vérité centrale.
- localStorage ne contient pas de donnée métier définitive.
- Exception : le PAD utilise `pt_pad_offline_queue_v17` comme file d'attente temporaire hors ligne.

## Corrections incluses

- Les formulaires PC ne sont plus faussement enregistrés en local si Supabase refuse.
- Les services PC ne sont plus faussement créés en local si Supabase refuse.
- Le PAD crée une action offline, puis synchronise vers Supabase dès que la connexion revient.
- Le planning est alimenté via `appointments` depuis formulaire simple ou service.
- Les modifications de rôles recalculent automatiquement `user_profiles.resolved_permissions`.
- La connexion PAD hashe correctement le mot de passe avant vérification.

## Important PAD

Comme le PAD n'utilise pas Supabase Auth, les tables protégées par RLS ne peuvent pas être écrites directement depuis le navigateur.
Pour une sync propre, déployer les Edge Functions :

- `supabase/functions/pad-auth`
- `supabase/functions/pad-sync`

Secrets requis :

- `URL`
- `ANON_KEY`
- `SERVICE_ROLE_KEY`

## SQL conseillé

Voir : `supabase/sql/PICOTRACK_V17_RLS_RECOMMENDED.sql`
