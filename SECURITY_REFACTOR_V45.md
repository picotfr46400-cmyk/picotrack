# PicoTrack V45 — Performance réelle et cohérence données

Corrections :
- démarrage sans double vérification bloquante ;
- chargement initial limité aux formulaires ;
- rôles et synchronisation lancés en arrière-plan ;
- planning chargé via API métier avec environment_code ;
- ouverture dossier rendez-vous : chargement à la demande des réponses liées ;
- visibilité métier par environnement, pas par licence.

SQL recommandé pour la performance :
```sql
create index if not exists idx_forms_environment_created on public.forms(environment_code, created_at);
create index if not exists idx_submissions_environment_form_created on public.submissions(environment_code, form_id, created_at desc);
create index if not exists idx_appointments_environment_date_time on public.appointments(environment_code, date, start_time);
create index if not exists idx_services_environment_created on public.services(environment_code, created_at);
create index if not exists idx_service_instances_environment_created on public.service_instances(environment_code, created_at desc);
```
