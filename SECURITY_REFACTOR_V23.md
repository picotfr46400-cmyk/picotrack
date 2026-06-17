# SECURITY / BUILD REFACTOR V23

Correction critique :
- L'écran blanc venait d'un asset JS non copié dans le dossier public au build Vercel.
- index.html référençait /assets/app.secured-v22.js.
- build.js copiait uniquement app.secured-v21.js.
- Vercel renvoyait donc index.html en text/html à la place du JavaScript.
- Chrome bloquait le script : MIME type text/html non exécutable.

Corrections :
- Création de /assets/app.secured-v23.js à partir de la V22.
- index.html pointe désormais vers /assets/app.secured-v23.js.
- build.js copie maintenant tous les fichiers du dossier assets au lieu d'un nom hardcodé.
- Cache service worker bumpé en v23.

À vérifier après déploiement :
- Ctrl + F5.
- Network > /assets/app.secured-v23.js doit répondre 200 avec Content-Type JavaScript.
- L'écran Utilisateurs doit reprendre le test des licences PROSPECT 99 / 88.
