# PicoTrack V40 — Correctif champs duplicables

## Corrections
- Correction du bouton `+ Ajouter` sur les champs duplicables en mode saisie.
- Correction des comparaisons strictes entre `form.id` numérique et `curSaisieFormId` texte.
- Support duplicable harmonisé pour texte, nombre, date, heure et datetime via `duplicable` ou `dup`.
- Ajout de wrappers sûrs `ptSafeSaisieAddDup` / `ptSafeSaisieRemoveDup` pour éviter les clics silencieux.

## SQL
Aucun SQL nécessaire.
