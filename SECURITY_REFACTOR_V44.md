# PicoTrack V44 — Performance Foundation réelle

Corrections :
- Suppression de l'appel bloquant synchrone `/api/bootstrap` au démarrage.
- Déduction locale du `environmentCode` depuis le hostname pour éviter un aller-retour réseau avant affichage.
- Suppression d'une authentification serveur doublée dans `/api/records` : chaque action reste authentifiée, mais on évite un cycle Auth/Profile/Session inutile par requête.
- Build allégé : le dossier `public/assets` ne publie plus toutes les anciennes versions `app.secured-v*.js`, uniquement la version courante.

À faire dans GitHub après déploiement validé :
- Supprimer les anciens `assets/app.secured-v*.js` sauf `assets/app.secured-v44.js`.
- Supprimer les anciens fichiers `SECURITY_REFACTOR_V*.md` sauf le dernier utile.
- Laisser `public/` être régénéré par `npm run build`.

SQL : aucun.
