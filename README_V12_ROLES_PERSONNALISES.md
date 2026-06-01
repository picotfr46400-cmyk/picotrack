# PicoTrack V12 — rôles personnalisés + accès par licence

Correction importante : l'accès à la supervision ne dépend plus du champ `role`.

## Nouvelle règle

- `license_type` = type d'accès technique : `supervision`, `pad`, `lecture`.
- `role` = rôle technique interne : `supervision_user`, `pad_user`, `super_admin`.
- `roles` = liste des rôles personnalisés créés dans l'application : `['1','2','3']`, ou tout autre ID.

Donc un utilisateur avec :

```json
{
  "role": "supervision_user",
  "roles": ["1", "2", "3"],
  "license_type": "supervision"
}
```

peut se connecter à l'interface Supervision.

## À faire côté Supabase

1. Lancer `supabase/sql/PICOTRACK_SCHEMA_PATCH.sql`.
2. Redéployer `invite-user`.
3. Redéployer `delete-user`.
4. Vérifier les secrets Edge Functions : `URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`.

## Migration des anciens comptes bloqués

Si un compte a encore `role = '1'`, il faut le convertir :

```sql
update public.user_profiles
set role = 'supervision_user', license_type = 'supervision', active = true
where license_type = 'supervision'
  and role not in ('super_admin', 'supervision_user');
```

Les rôles personnalisés dans `roles` sont conservés.
