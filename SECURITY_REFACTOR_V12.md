# PicoTrack Security Refactor V12

- Ajout du mapping Supabase pour `services` et `service_instances`.
- Création/modification service persistée dans la table `services`.
- Rechargement `SERVICES_DATA` et `SERVICE_INSTANCES_DATA` depuis Supabase après authentification.
- Normalisation `nom/description/couleur/actif/form_id/id_pattern/card_config/kanban_groups`.
- Conservation de la sécurisation `/api/records`.
