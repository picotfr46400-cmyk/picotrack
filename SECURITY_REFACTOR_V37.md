# PicoTrack V37 — Persistance réelle des formulaires

Correction appliquée :
- ajout de `formToDb()` ;
- ajout de `mapFormFromDb()` ;
- conservation du chargement serveur sécurisé de V36 ;
- la création/modification de formulaire passe maintenant réellement par `DB.createForm()` / `DB.updateForm()` au lieu de rester en mémoire locale.

SQL : aucun.

Test à faire : créer un formulaire, actualiser, vérifier qu’il reste affiché.
