# PicoTrack V16.2 — Correction RBAC front + anti-fausse sauvegarde

## Ce qui a été corrigé

- Ajout de `js/core/security.js` : helpers `canRead`, `canWrite`, `canAdmin`, `assertCanWrite`, `assertCanAdmin`.
- Le profil connecté récupère maintenant `resolved_permissions` depuis `user_profiles`.
- Le front ignore toute clé Supabase dynamique : seule la clé `anon` codée dans `js/core/supabase.js` est utilisée côté navigateur.
- Les écritures critiques passent maintenant par des garde-fous front :
  - `forms_admin` pour créer/modifier/supprimer les formulaires.
  - `services_admin` pour créer/modifier/supprimer les services.
  - `databases_admin` pour créer/modifier les bases dynamiques.
  - `forms_prod` pour créer des soumissions.
  - `services_prod` pour créer/modifier des demandes service.
- Les sauvegardes formulaires ne mettent plus à jour `FORMS_DATA` si Supabase refuse l'écriture.
- Les sauvegardes services ne mettent plus à jour `SERVICES_DATA` si Supabase refuse l'écriture.
- La suppression formulaire ne supprime plus localement avant validation Supabase.
- Le compte lecture seule ne peut plus ouvrir le builder formulaire en édition.

## Important Supabase

Le vrai verrouillage reste dans les RLS policies. Le front évite les fausses impressions de sauvegarde, mais Supabase doit rester la source de vérité.

