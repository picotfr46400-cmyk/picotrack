# Correctif PDF PicoTrack

Correction appliquée : le générateur PDF utilisait l'instruction PDF `Td` pour positionner les lignes. `Td` déplace le curseur de façon relative, ce qui faisait sortir presque tout le contenu hors de la page après le titre.

La génération utilise maintenant `Tm` pour positionner chaque ligne en coordonnées absolues. Le PDF affiche donc bien :
- titre,
- formulaire,
- référence,
- date,
- utilisateur,
- détails de tous les champs exploitables.

Fichier modifié : `js/core/pdf.js`.
