# PicoTrack V35 — Correction suppression formulaires

## Correction
- Restauration de la méthode `DB.deleteForm(id)` appelée par le bouton de suppression des formulaires.
- Passage du bundle en `app.secured-v35.js` pour éviter l'ancien cache navigateur.
- Sécurisation côté serveur de `api/records.js` : la suppression passe désormais par l'API serveur authentifiée et reste limitée à l'environnement utilisateur quand le compte n'est pas plateforme.
- Nettoyage des soumissions liées avant suppression d'un formulaire pour éviter les données orphelines.

## SQL
Aucun SQL nécessaire.

## Test attendu
1. Ouvrir Form Builder.
2. Supprimer un formulaire test.
3. Le formulaire disparaît sans erreur `DB.deleteForm is not a function`.
4. Recharger la page : le formulaire ne revient pas.
