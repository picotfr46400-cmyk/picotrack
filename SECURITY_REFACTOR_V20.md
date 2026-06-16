# PicoTrack — Security V20

## Diagnostic confirmé
Les headers de sécurité sont bien présents dans Chrome sur la réponse 200 de l'application :
- Content-Security-Policy
- X-Content-Type-Options
- Referrer-Policy
- Permissions-Policy
- Strict-Transport-Security

Les scanners externes reçoivent une réponse `HTTP/1.1 401 Unauthorized` avant d'atteindre l'application.
Cette réponse est générée par Vercel Deployment Protection sur l'URL temporaire `*.vercel.app`.
Elle ne peut pas être corrigée par le code applicatif, car Vercel bloque la requête avant l'exécution de l'application.

## Corrections ajoutées
- Ajout de `/.well-known/security.txt`.
- Ajout de `/security.txt`.
- Copie automatique du dossier `.well-known` dans `public` au build.
- Ajout d'une balise meta `referrer` dans `index.html`.

## Action Vercel nécessaire
Pour obtenir un score correct sur les scanners externes :
1. Tester le domaine public de production `picotrack.fr`, pas l'URL temporaire protégée Vercel.
2. Ou désactiver temporairement Vercel Deployment Protection sur le déploiement testé.
3. Puis relancer SecurityHeaders, Mozilla Observatory et Pentest Tools.

## Point important
Le score D actuel ne signifie pas que la page applicative n'a pas les headers.
Il signifie que le scanner est arrêté par une réponse 401 de protection Vercel qui ne contient pas ces headers.
