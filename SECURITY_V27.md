# PicoTrack V27 - refonte backend proxy

- Le navigateur ne charge plus les modules `js/core` et `js/features`.
- `supabase.min.js`, `babel.min.js`, `runtime-config.js` public et `pad-mode.js` public sont retirés de `index.html`.
- Les accès Supabase passent par `/api/data`, `/api/auth` et `/api/function`.
- Le bundle public unique est `/assets/app.fb7e8d60f2c3.js`.
- Les variables Supabase restent côté Vercel.

Variables Vercel nécessaires :
- `URL_SUPABASE_VITE` ou `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `RESEND_API_KEY` si mail activé
- `SUPABASE_SERVICE_ROLE_KEY` si tes API PAD/mail l’utilisent déjà
