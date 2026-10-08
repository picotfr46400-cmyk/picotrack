-- 2026-10-08 — idempotence PAD, clé d'événement, purge et effacement.
-- Migration additive. Ne pas l'exécuter depuis un déploiement applicatif.
--
-- Durée de conservation par défaut : 3 ans.
-- Aucune durée n'est définie pour les saisies ; le journal prend la même.
-- Balayage opérateur, jamais appelé par l'application :
--   select public.purge_submission_audit_log(interval '3 years');
--
-- Effacement RGPD : après suppression d'une saisie, le serveur appelle
-- la même fonction avec target_environment et target_submissions.
-- Les lignes concernées sont anonymisées (plus de valeurs, d'acteur ni d'appareil).
-- C'est le seul chemin autorisé à modifier ou supprimer le journal :
-- le trigger d'ajout seul laisse passer UPDATE et DELETE seulement pendant cet appel.

alter table public.submission_audit_log
  add column if not exists idempotency_key text;

alter table public.submission_audit_log
  drop constraint if exists submission_audit_log_idem_len;

alter table public.submission_audit_log
  add constraint submission_audit_log_idem_len
  check (idempotency_key is null or char_length(idempotency_key) between 1 and 160);

create unique index if not exists submission_audit_log_idem_idx
  on public.submission_audit_log (environment_code, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.pad_sync_receipts (
  environment_code text not null,
  action_id text not null,
  submission_id text not null,
  service_instance_id text,
  created_at timestamptz not null default now(),
  primary key (environment_code, action_id),
  constraint pad_sync_receipts_env_len check (char_length(environment_code) between 1 and 80),
  constraint pad_sync_receipts_action_len check (char_length(action_id) between 1 and 120),
  constraint pad_sync_receipts_submission_len check (char_length(submission_id) between 1 and 80),
  constraint pad_sync_receipts_instance_len check (service_instance_id is null or char_length(service_instance_id) between 1 and 80)
);

alter table public.pad_sync_receipts enable row level security;
alter table public.pad_sync_receipts force row level security;

revoke all on table public.pad_sync_receipts from public;
revoke all on table public.pad_sync_receipts from anon;
revoke all on table public.pad_sync_receipts from authenticated;
grant select, insert on table public.pad_sync_receipts to service_role;

create or replace function public.submission_audit_log_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (tg_op = 'UPDATE' or tg_op = 'DELETE')
     and coalesce(current_setting('picotrack.audit_purge', true), '') = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  raise exception 'submission_audit_log est en ajout seul' using errcode = '42501';
end;
$$;

revoke all on function public.submission_audit_log_append_only() from public;
revoke all on function public.submission_audit_log_append_only() from anon;
revoke all on function public.submission_audit_log_append_only() from authenticated;

drop function if exists public.purge_submission_audit_log(interval);

create or replace function public.purge_submission_audit_log(
  retention interval default null,
  target_environment text default null,
  target_submissions text[] default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), session_user);
  removed integer := 0;
  erasure boolean := target_submissions is not null;
begin
  if actor not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'purge réservée à service_role' using errcode = '42501';
  end if;
  if erasure then
    if target_environment is null or char_length(btrim(target_environment)) < 1 then
      raise exception 'environnement d''effacement invalide' using errcode = '22023';
    end if;
    if coalesce(cardinality(target_submissions), 0) < 1 or cardinality(target_submissions) > 100 then
      raise exception 'saisies d''effacement invalides' using errcode = '22023';
    end if;
    perform set_config('picotrack.audit_purge', 'on', true);
    update public.submission_audit_log
       set actor_id = '',
           actor_name = '',
           actor_role = '',
           actor_license_type = '',
           device_label = '',
           device_captured_at = null,
           detail = '{"erased":true}'::jsonb
     where environment_code = target_environment
       and submission_id = any(target_submissions);
    get diagnostics removed = row_count;
    return removed;
  end if;
  if retention is null or retention < interval '1 day' then
    raise exception 'durée de conservation invalide' using errcode = '22023';
  end if;
  perform set_config('picotrack.audit_purge', 'on', true);
  delete from public.submission_audit_log
   where occurred_at < now() - retention
      or submission_id in (
        select submission_id
          from public.submission_audit_log
         where event_type = 'deleted'
           and occurred_at < now() - retention
      );
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_submission_audit_log(interval, text, text[]) from public;
revoke all on function public.purge_submission_audit_log(interval, text, text[]) from anon;
revoke all on function public.purge_submission_audit_log(interval, text, text[]) from authenticated;
grant execute on function public.purge_submission_audit_log(interval, text, text[]) to service_role;

comment on function public.purge_submission_audit_log(interval, text, text[]) is
  'Purge du journal, service_role seulement. Durée par défaut : 3 ans, identique aux saisies faute d''autre durée définie. Le balayage par durée n''est pas appelé par l''application. L''effacement d''une saisie cible target_submissions et anonymise ses lignes. Seuls UPDATE et DELETE passent le trigger d''ajout seul pendant cet appel.';
