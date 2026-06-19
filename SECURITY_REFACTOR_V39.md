# PicoTrack V39 — Créneaux horaires étendus + champs duplicables

Correctifs appliqués :

- Correction de la génération des créneaux lorsque l'heure de fin est inférieure ou égale à l'heure de début.
  - Exemple : 01:00 → 00:00 génère désormais les créneaux de 01:00 jusqu'à 23:30.
  - Le moteur comprend maintenant les plages qui passent minuit.

- Correction du bouton `+ Ajouter` des champs duplicables dans la saisie formulaire.
  - Les fonctions de duplication sont exposées correctement au navigateur.
  - Les boutons sont forcés en `type="button"` pour éviter tout comportement parasite.
  - Compatibilité renforcée entre les propriétés `duplicable` et `dup`.

SQL : aucun.
