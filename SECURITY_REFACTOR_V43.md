# PicoTrack V43 — Performance + lecture réelle des réponses

Corrections importantes :
- les listes métier passent par `/api/records` côté serveur avec filtre environnement contrôlé ;
- les réponses de formulaires sont chargées à l'ouverture du formulaire, pas au démarrage global ;
- correction du cas où Supabase contient des soumissions mais l'écran affiche `0 réponse chargée` ;
- conservation du chargement léger V42, mais sans perte d'affichage côté utilisateur.

Nettoyage conseillé GitHub après validation V43 :
- supprimer les anciens fichiers `assets/app.secured-v*.js` non référencés ;
- garder uniquement `assets/app.secured-v43.js` ;
- déplacer ou supprimer les anciens `SECURITY_REFACTOR_V*.md` si tu veux alléger le dépôt ;
- ne pas modifier les dossiers `api`, `icons`, `style.css`, `manifest.json`, `sw.js` sans audit séparé.
