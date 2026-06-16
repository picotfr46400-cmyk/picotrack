# PicoTrack — Security Refactor V19

## Corrections réalisées
- En-têtes sécurité appliqués directement dans les réponses API serveur.
- Règle explicite `/api/(.*)` ajoutée dans `vercel.json`.
- Nettoyage des anciens bundles frontend : conservation de `app.secured-v19.js` uniquement.
- `index.html` pointe maintenant vers `/assets/app.secured-v19.js`.
- Suppression de `unsafe-eval` dans la CSP.
- Rebuild du dossier `public` avec uniquement les fichiers nécessaires.

## À tester après déploiement
1. Page principale `/`.
2. Route API protégée `/api/records`.
3. Connexion + chargement des formulaires.
