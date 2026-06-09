# PicoTrack V29 — migration build + proxy serveur

Cette version ne sert plus directement `index.html` complet, `js/core/*`, `js/features/*`, `supabase.min.js`, `babel.min.js` ou `runtime-config.js`.

Vercel doit exécuter `npm run build` et servir uniquement le dossier `dist`.

Variables Vercel nécessaires :
- `URL_SUPABASE_VITE` ou `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- recommandé : `SUPABASE_SERVICE_ROLE_KEY` pour le proxy serveur, PAD et automatisations
- `RESEND_API_KEY` si mail actif
- `PAD_SESSION_SECRET` recommandé

Après déploiement : ouvrir en navigation privée ou vider le service worker.
