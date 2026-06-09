# PicoTrack V28 - shell masqué + production proxy

Corrections appliquées :
- `index.html` ne contient plus la structure complète des écrans.
- Le shell HTML est injecté par un fichier `assets/shell.*.js` encodé.
- Les anciens modules `js/core/*` et `js/features/*` restent absents du déploiement.
- `supabase.min.js`, `babel.min.js`, `runtime-config.js` et `pad-mode.js` ne sont pas référencés par `index.html`.
- `sw.js` a été nettoyé/minifié et force le réseau pour HTML/CSS/JS.

Limite assumée : le DOM reste visible dans l’onglet Elements après exécution, c’est normal sur le web. L’objectif est de ne plus exposer le code source structurel dans Sources/Network.
