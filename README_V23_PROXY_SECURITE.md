# PicoTrack V23 — Proxy serveur sécurité

Cette version corrige le problème visible dans DevTools > Network : le navigateur ne contacte plus directement les endpoints Supabase `/rest/v1/...`.

## Ce qui change

- Les appels données passent par `/api/supabase-proxy`.
- La connexion passe par `/api/auth`.
- Les Edge Functions passent par `/api/function-proxy`.
- `/api/client-config` ne renvoie plus les clés Supabase au navigateur.
- Les noms de tables ne sont plus visibles dans les URL Network.
- Les clés Supabase doivent être stockées dans les variables d'environnement Vercel.

## Variables Vercel requises

À ajouter dans Vercel > Project Settings > Environment Variables :

- `PICOTRACK_DEFAULT_SUPABASE_URL`
- `PICOTRACK_DEFAULT_SUPABASE_ANON_KEY`
- `PICOTRACK_DEFAULT_ENVIRONMENT_CODE` = `DEMO`
- `PICOTRACK_DEFAULT_CLIENT_CODE` = `demo`

Pour le multi-client futur :

`PICOTRACK_CLIENT_CONFIGS`

Exemple :

```json
{
  "demo.picotrack.fr": {
    "clientCode": "demo",
    "environmentCode": "DEMO",
    "supabaseUrl": "https://xxxx.supabase.co",
    "supabaseAnonKey": "xxxx"
  }
}
```

## Limite importante

On ne peut pas rendre un front totalement invisible : le navigateur doit toujours télécharger HTML/CSS/JS.
La bonne sécurité consiste à déplacer progressivement la logique métier vers `/api/*`, ce que cette version commence à faire.
