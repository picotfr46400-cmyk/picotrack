# PicoTrack V34 — Détection universelle des sous-domaines

## Fichier modifié
- `api/_server-supabase.js`

## Correction
La détection client n'est plus limitée à `PROSPECT` et `DEMO`.

Exemples :
- `prospect.picotrack.fr` => `PROSPECT`
- `efc.picotrack.fr` => `EFC`
- `demo.picotrack.fr` => `DEMO`
- `picotrack.fr` / `www.picotrack.fr` / `app.picotrack.fr` => `PROD`
- preview Vercel `picotrack-efc-xxxx.vercel.app` => `EFC`

## Variables attendues sur Vercel pour un client EFC
- `EFC_SUPABASE_URL`
- `EFC_SUPABASE_ANON_KEY`
- `EFC_SUPABASE_SERVICE_ROLE_KEY`

Format alternatif accepté :
- `PICOTRACK_EFC_SUPABASE_URL`
- `PICOTRACK_EFC_SUPABASE_ANON_KEY`
- `PICOTRACK_EFC_SUPABASE_SERVICE_ROLE_KEY`

## SQL
Aucun SQL nécessaire pour cette correction.
