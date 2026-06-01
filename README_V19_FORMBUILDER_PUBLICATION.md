# PicoTrack V19 — Correction définitive Form Builder / Publication

Règle métier appliquée :

- Form Builder affiche tous les formulaires Supabase, y compris les brouillons (`published=false`).
- PAD Terrain et formulaires de production affichent uniquement les formulaires `actif=true` et `published=true`.
- Le mapper Supabase conserve désormais `published`, `tenant_id`, `created_at` et `updated_at`.
- Le service worker V19 ne met plus en cache HTML/JS/CSS pour éviter qu'une ancienne version Vercel reste affichée.

Après déploiement :
1. Vercel > Redeploy sans cache.
2. Dans le navigateur : Ctrl+F5.
3. Si besoin : DevTools > Application > Service Workers > Unregister, puis Storage > Clear site data.
