set lock_timeout = '5s';

-- Passage prod EFC (19/10) : index des filtres de v2 et retrait d'une fonction non versionnée.
-- Idempotente (if not exists / if exists). Aucune donnée modifiée.
-- - appointments (environment_code, form_id, date, start_time) : planning et disponibilités par environnement.
-- - service_instances (submission_id) : dossier lié à une saisie (fiche, PDF, traçabilité).
-- - public.temp_export_insert(regclass, text) : créée à la main sur EFC (SQL dynamique sur un texte libre),
--   utilisée nulle part (grep v2 et main : code, api, scripts, migrations, workflows), supprimée.

create index if not exists idx_appointments_env_form_date_time
  on public.appointments (environment_code, form_id, date, start_time);

create index if not exists idx_service_instances_submission_id
  on public.service_instances (submission_id);

drop function if exists public.temp_export_insert(regclass, text);
