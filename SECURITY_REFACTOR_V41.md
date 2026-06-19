# PicoTrack V41 — Suppression utilisateur licence/profil

Correction ciblée de la suppression utilisateur depuis l'écran Administration / Utilisateurs.

## Correctifs
- Le front ne transmet plus aveuglément l'id de ligne licence comme UUID utilisateur.
- `DB.deleteLicense()` distingue maintenant :
  - UUID utilisateur Supabase Auth / `user_profiles.id`,
  - ID numérique de ligne `licenses.id`.
- L'API `delete-user` sait supprimer proprement :
  - le profil `user_profiles`,
  - le compte Supabase Auth quand l'UUID est retrouvé,
  - la ligne `licenses`, afin de libérer le quota.
- Recherche de secours par `email + environment_code` pour les anciennes lignes sans `user_id`.

## SQL
Aucun SQL nécessaire.
