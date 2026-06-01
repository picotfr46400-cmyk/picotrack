# PicoTrack V20 — Sécurisation immédiate et configuration serveur

Cette version répond aux premières exigences réalisables maintenant sans refonte totale de l’application.

## Ce qui a été modifié

1. La configuration Supabase n’est plus codée en dur dans `js/core/supabase.js`.
2. Le navigateur charge la configuration publique via `/api/client-config`.
3. Le mapping sous-domaine → projet Supabase est préparé côté serveur.
4. L’envoi mail reste côté serveur via `/api/send-mail`.
5. La génération du PDF joint aux mails automatiques est déplacée côté serveur via `api/_pdf.js`.
6. Le CORS de `/api/send-mail` n’utilise plus `*` par défaut.
7. Le flux automatisé reste compatible : formulaire → soumission → PDF serveur → mail Resend → historique local.

## Variables Vercel à configurer

### Option recommandée multi-clients

Créer une variable `PICOTRACK_CLIENT_CONFIGS` contenant un JSON :

```json
{
  "demo.picotrack.fr": {
    "clientCode": "demo",
    "environmentCode": "DEMO",
    "supabaseUrl": "https://PROJECT_REF.supabase.co",
    "supabaseAnonKey": "ANON_KEY"
  },
  "prospect.picotrack.fr": {
    "clientCode": "prospect",
    "environmentCode": "DEMO",
    "supabaseUrl": "https://PROJECT_REF.supabase.co",
    "supabaseAnonKey": "ANON_KEY"
  }
}
```

### Option fallback DEMO

```txt
PICOTRACK_DEFAULT_SUPABASE_URL=https://PROJECT_REF.supabase.co
PICOTRACK_DEFAULT_SUPABASE_ANON_KEY=ANON_KEY
PICOTRACK_DEFAULT_CLIENT_CODE=demo
PICOTRACK_DEFAULT_ENVIRONMENT_CODE=DEMO
```

### Mail

```txt
RESEND_API_KEY=...
RESEND_FROM=PicoTrack <notifications@noreply.picotrack.fr>
PICOTRACK_ALLOWED_ORIGINS=https://picotrack.fr,https://www.picotrack.fr,https://prospect.picotrack.fr
```

## Important

La clé anon Supabase reste une clé publique par nature. La vraie sécurité doit venir des règles RLS Supabase et des routes serveur pour toutes les opérations sensibles. La clé service_role ne doit jamais être exposée au navigateur.
