-- Journal de traçabilité des saisies (ajout seul).
-- Migration additive : ce n'est pas un export complet du schéma client.
-- À appliquer manuellement sur la base de test. Ne pas l'exécuter depuis l'application.
-- Aucune policy UPDATE ou DELETE : les rôles Data API n'ont aucun droit d'écriture.
-- Le rôle service contourne RLS ; les triggers BEFORE UPDATE/DELETE/TRUNCATE bloquent quand même la modification.

create table if not exists public.submission_audit_log (
  id uuid primary key default gen_random_uuid(),
  environment_code text not null,
  submission_id text not null,
  service_instance_id text,
  event_type text not null,
  occurred_at timestamptz not null default now(),
  device_captured_at timestamptz,
  actor_id text,
  actor_name text,
  actor_role text,
  actor_license_type text,
  origin text not null,
  device_label text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint submission_audit_log_env_len check (char_length(environment_code) between 1 and 80),
  constraint submission_audit_log_submission_len check (char_length(submission_id) between 1 and 80),
  constraint submission_audit_log_instance_len check (service_instance_id is null or char_length(service_instance_id) between 1 and 80),
  constraint submission_audit_log_event_type_chk check (event_type in (
    'created', 'updated', 'status_changed', 'validated', 'refused', 'returned',
    'assigned', 'reassigned', 'commented', 'signed', 'closed', 'reopened',
    'archived', 'deleted', 'restored', 'viewed', 'exported', 'pad_synced',
    'email_sent', 'form_filled', 'db_updated'
  )),
  constraint submission_audit_log_origin_chk check (origin in ('supervision', 'pad')),
  constraint submission_audit_log_detail_object_chk check (jsonb_typeof(detail) = 'object'),
  constraint submission_audit_log_detail_size_chk check (octet_length(detail::text) <= 24000)
);

create index if not exists submission_audit_log_submission_idx
  on public.submission_audit_log (environment_code, submission_id, occurred_at desc);

alter table public.submission_audit_log enable row level security;
alter table public.submission_audit_log force row level security;

revoke all on table public.submission_audit_log from public;
revoke all on table public.submission_audit_log from anon;
revoke all on table public.submission_audit_log from authenticated;
revoke update, delete, truncate on table public.submission_audit_log from service_role;
grant select, insert on table public.submission_audit_log to service_role;

create or replace function public.submission_audit_log_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'submission_audit_log est en ajout seul' using errcode = '42501';
end;
$$;

revoke all on function public.submission_audit_log_append_only() from public;
revoke all on function public.submission_audit_log_append_only() from anon;
revoke all on function public.submission_audit_log_append_only() from authenticated;

drop trigger if exists submission_audit_log_no_update on public.submission_audit_log;
create trigger submission_audit_log_no_update
  before update on public.submission_audit_log
  for each row execute function public.submission_audit_log_append_only();

drop trigger if exists submission_audit_log_no_delete on public.submission_audit_log;
create trigger submission_audit_log_no_delete
  before delete on public.submission_audit_log
  for each row execute function public.submission_audit_log_append_only();

drop trigger if exists submission_audit_log_no_truncate on public.submission_audit_log;
create trigger submission_audit_log_no_truncate
  before truncate on public.submission_audit_log
  for each statement execute function public.submission_audit_log_append_only();

comment on table public.submission_audit_log is
  'Journal d''audit des saisies, ajout seul. Pas de policy UPDATE/DELETE. Horodatage et auteur sont posés par le serveur.';
