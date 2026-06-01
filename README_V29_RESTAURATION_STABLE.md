# PicoTrack V29 — Restauration stable vérifiée

Base utilisée : `picotrack-main (11).zip`.

Cette version annule les générations précédentes qui avaient corrompu `index.html` ou `vercel.json`.

## Vérifications effectuées

- `index.html` commence par `<!DOCTYPE html>`.
- `vercel.json` est un JSON valide.
- Le runtime référencé par `index.html` existe : `assets/picotrack.runtime.v23.js`.
- Les fichiers JS/API ont passé un contrôle de syntaxe `node --check`.
- Le ZIP final a été ré-ouvert et contrôlé après génération.

## Important

Cette version vise d'abord à restaurer une base déployable et fonctionnelle.
Elle ne prétend pas finaliser toute la sécurisation type KeepTracking.
La migration serveur/proxy devra être faite ensuite par étapes ciblées, sans recompacter ni supprimer l'arborescence.
