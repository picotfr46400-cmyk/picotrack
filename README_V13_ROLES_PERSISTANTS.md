# V13 — Rôles personnalisés persistants Supabase

Objectif : les rôles créés dans PicoTrack ne disparaissent plus quand on change de compte.

## À faire dans Supabase

1. Ouvrir SQL Editor.
2. Exécuter : `supabase/sql/PICOTRACK_ROLES_PERSISTENCE.sql`.
3. Redéployer Vercel avec ce zip.
4. Tester : créer un rôle avec le super admin, se connecter avec un autre compte du même environnement, vérifier que le rôle apparaît.

## Principe

- Les rôles personnalisés sont stockés dans `public.app_roles`.
- Ils sont liés à `tenant_id` et `environment_code`.
- `roles` dans `user_profiles` contient les IDs de ces rôles.
- `license_type` reste la source d’accès technique : `supervision` ou `pad`.
