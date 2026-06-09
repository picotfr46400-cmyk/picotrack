# PicoTrack — audit sécurité appliqué

Base utilisée : `picotrack-main (18).zip`.

## Vérifications fonctionnelles conservées
- Module Académie PicoTrack présent : `v-academy` et `academy-wrap` conservés dans `index.html`.
- Mode aide contextuelle inclus dans le bundle : `js/features/academy-help.js` est bien intégré.
- Bouton topbar `Mode aide ON/OFF` conservé.
- Bouton Académie `Activer/Désactiver le mode aide` conservé.
- Styles du mode aide conservés dans `style.css`, notamment le tooltip en `z-index:2147483647`.
- `pad-mode.js` conservé séparément et chargé après le bundle.

## Sécurisation appliquée
- Suppression des fichiers JS racine en double.
- Suppression du dossier source `js/` lisible publiquement après bundling.
- Regroupement des modules applicatifs dans `assets/picotrack.bundle.js`.
- Extraction du builder React inline dans `assets/picotrack-builder.jsx`.
- Suppression des README / rapports techniques du déploiement public.
- Durcissement des headers Vercel.
- `robots.txt` ajouté pour bloquer l’indexation.
- `/api/runtime-config.js` garde uniquement la configuration publique nécessaire.
- `/api/send-mail.js` garde `RESEND_API_KEY` côté serveur.

## Limite assumée
Le JavaScript exécuté dans le navigateur reste récupérable. Cette version réduit fortement la lecture facile via Inspecter, mais la vraie protection totale demande de déplacer PDF, droits, licences, automatisations et logique métier côté serveur.
