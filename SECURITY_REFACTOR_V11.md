# PicoTrack secured V11

Correction ciblée du rechargement Form Builder.

- `forms` est bien sauvegardé dans Supabase.
- `initial_load` lit désormais côté serveur authentifié pour éviter les blocages RLS de lecture dans le bac à sable.
- Ajout d’un fallback de chargement si le `environment_code` actif ne correspond pas encore au code stocké.
- Normalisation des formulaires Supabase vers le format attendu par l’interface : `nom`, `desc`, `type`, `fields`, `actif`, `published`, `resp`.
- Ajout de `syncAllFromSupabase()` qui recharge réellement les données dans `FORMS_DATA` et `filtered`.
- Nouveau bundle `app.secured-v11.js` pour casser le cache.
