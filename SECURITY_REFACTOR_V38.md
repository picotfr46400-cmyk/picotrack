# PicoTrack V38 — Créneaux : disponibilité réelle et blocage avant mail

Corrections :
- Ajout des lectures `DB.getAppointmentsForDate()` et `DB.getAppointmentsForSlot()`.
- Les créneaux affichent les places restantes selon les rendez-vous déjà enregistrés.
- Si un créneau est complet, la validation du formulaire est bloquée.
- Si une concurrence arrive entre l'affichage et la validation, la saisie est annulée et aucun mail de succès n'est déclenché.
- Ajout d'un rollback de la soumission si la création du rendez-vous planning échoue.

SQL : aucun.
