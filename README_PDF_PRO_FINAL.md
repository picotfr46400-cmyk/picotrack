# PicoTrack — Environnement Prospect

## Modification réalisée

Le fichier `js/core/supabase.js` ne pointe plus uniquement vers l'environnement Démo.

Il choisit maintenant automatiquement le Supabase selon le nom de domaine :

- Domaine contenant `picotrack-prospect`
- Domaine `prospect.picotrack.fr`
- Sous-domaine commençant par `prospect.`

Dans ces cas, PicoTrack utilise :

```txt
https://ukucbfxyvyvtlglujoht.supabase.co
```

Sinon, par défaut, il conserve l'environnement Démo existant :

```txt
https://jcanufkmcslxwmheqccp.supabase.co
```

## Résultat attendu

- Le projet Vercel Démo continue de pointer vers Supabase Démo.
- Le projet Vercel Prospect pointe vers Supabase Prospect.
- Les données ne se mélangent pas.
- L'environnement Prospect démarre neuf, car son Supabase vient d'être créé avec le schéma uniquement.

## Attention

Les Edge Functions doivent exister aussi dans le projet Supabase Prospect si les fonctions suivantes sont utilisées :

- `invite-user`
- `delete-user`
- envoi de mail
- automatisations PDF/mail

Le front est prêt, mais les fonctions Supabase doivent être déployées côté projet Supabase Prospect si nécessaire.
