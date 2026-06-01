# PicoTrack V18 — Supabase source de vérité

Cette version supprime les données métier de démonstration codées en dur.

Règles appliquées :
- Supabase = source de vérité centrale.
- Les tableaux JS (`FORMS_DATA`, `SERVICES_DATA`, etc.) sont uniquement des caches mémoire de session.
- Le localStorage métier est interdit, sauf pour la file offline PAD.
- Le PAD stocke uniquement une file temporaire `pt_pad_offline_queue_v17`, puis synchronise via `pad-sync`.
- Au refresh, l'application recharge formulaires, services, rôles, soumissions, instances, bases et utilisateurs depuis Supabase.
- Aucune migration automatique de données de démonstration vers Supabase.

À tester après déploiement :
1. PC : refresh = les données Supabase restent affichées.
2. Formulaire simple : création dans `submissions`, puis éventuel `appointments`.
3. Service : création dans `service_instances`, puis éventuel `appointments`.
4. PAD offline : action en attente, puis sync via Edge Function `pad-sync`.
5. RBAC : modifier un rôle recalcule `user_profiles.resolved_permissions`.
