# PicoTrack V15 — rôles propres et persistants

Objectif : arrêter le mélange entre rôles numériques locaux `1/2/3`, rôles texte `admin/manager/operator` et rôles personnalisés.

## Source de vérité
- Table Supabase : `public.app_roles`
- Liaison utilisateur : `user_profiles.roles` contient une liste d'UUID de rôles.
- `user_profiles.role` reste un rôle technique : `super_admin`, `supervision_user`, `pad_user`.
- `user_profiles.license_type` pilote l'accès : `supervision` ou `pad`.

## À faire côté Supabase
Lancer dans SQL Editor :

```sql
supabase/sql/PICOTRACK_V15_ROLES_CLEAN.sql
```

## Tests faits localement
- Syntaxe JavaScript vérifiée avec `node --check`.
- Présence des méthodes `DB.getRoles`, `DB.saveRole`, `DB.deleteRole`.
- Conversion front des anciens rôles `1/2/3` vers UUID stables.
