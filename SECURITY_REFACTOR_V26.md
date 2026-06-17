# SECURITY / USERS REFACTOR V26

Correction réelle de la liste Utilisateurs :
- V25 dépendait encore de lectures front/RLS pour `licenses`.
- Selon les policies Supabase, la table `licenses` pouvait ne pas être visible côté navigateur.
- Résultat : la licence existait en base, mais l'écran Utilisateurs affichait toujours 0 / 2.

Modifications :
- Ajout de `list-users` dans `/api/function`.
- Lecture serveur via service_role, réservée aux admins.
- Fusion côté serveur de `user_profiles` + `licenses`.
- Déduplication par email/login/username/license_key.
- Exclusion des comptes plateforme (`GLOBAL`, `super_admin`, `platform`).
- Front `DB.getUsersByTenant()` appelle maintenant `sbFunction("list-users")`.
- Fallback local conservé si l'API serveur est indisponible.
- `_isClientVisibleUser` repassée en fonction synchrone.
- Passage asset `app.secured-v26.js`.

Résultat attendu :
- Une licence active dans `public.licenses` avec `environment_code = PROSPECT` apparaît dans Utilisateurs.
- Le compteur Supervision doit passer à 1 / 2 si la licence est active.
