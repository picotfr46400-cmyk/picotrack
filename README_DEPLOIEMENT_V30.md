# PicoTrack V30 — vrai root sécurisé

Cette archive est volontairement nettoyée : elle ne contient plus les sources legacy publiques (`js/`, `src/legacy/`, `pad-mode.js`, anciens bundles, runtime-config public).

Le déploiement sert directement la racine préparée :
- `index.html` minimal ;
- `assets/app.<hash>.js` unique ;
- `/api/*` pour Supabase/Auth/Functions ;
- pas de `supabase.min.js` côté navigateur ;
- pas de `runtime-config.js` côté navigateur ;
- pas de Babel navigateur.

Variables Vercel :
- `URL_SUPABASE_VITE` ou `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` recommandé pour le proxy serveur
- `RESEND_API_KEY` si mails actifs
- `PICOTRACK_CLIENT_CODE` / `CODE_CLIENT_PICOTRACK`
- `PICOTRACK_ENVIRONMENT_CODE` / `PICOTRACK_ENVIRONNEMENT_CODE`

Après déploiement, faire : DevTools > Application > Service Workers > Unregister, puis vider le cache et recharger.
