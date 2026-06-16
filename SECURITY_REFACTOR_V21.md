# PicoTrack V21 - Configuration Supabase par domaine

Objectif : adapter automatiquement PicoTrack au domaine appelé, sans mélanger production, prospect et sandbox.

## Correction principale

Le serveur résout maintenant la configuration Supabase à partir du host HTTP :

1. `PICOTRACK_CONFIG_JSON` si présent.
2. Variables préfixées selon le domaine : `PROD_`, `PROSPECT_`, `DEMO_`.
3. Anciennes variables en fallback uniquement.

## Variable recommandée

Créer côté Vercel une variable serveur `PICOTRACK_CONFIG_JSON` :

```json
{
  "picotrack.fr": {
    "clientCode": "picotrack",
    "environmentCode": "PROD",
    "supabaseUrl": "https://xxx.supabase.co",
    "supabaseAnonKey": "...",
    "supabaseServiceRoleKey": "..."
  },
  "prospect.picotrack.fr": {
    "clientCode": "prospect",
    "environmentCode": "PROSPECT",
    "supabaseUrl": "https://yyy.supabase.co",
    "supabaseAnonKey": "...",
    "supabaseServiceRoleKey": "..."
  },
  "picotrack-prospect.vercel.app": {
    "clientCode": "prospect",
    "environmentCode": "PROSPECT",
    "supabaseUrl": "https://yyy.supabase.co",
    "supabaseAnonKey": "...",
    "supabaseServiceRoleKey": "..."
  }
}
```

Aucune clé sensible n'est renvoyée au navigateur. `/api/bootstrap` retourne seulement le client, l'environnement et l'état de configuration.

## Fichiers modifiés

- `api/_server-supabase.js`
- `api/auth.js`
- `api/function.js`
- `api/records.js`
- `api/bootstrap.js`
- `index.html`
- `build.js`
- `sw.js`

