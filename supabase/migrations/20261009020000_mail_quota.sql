-- Compteur de plafond, dans la même opération que le claim.
-- À appliquer à la main, d'abord sur la démo, jamais sur EFC. L'application ne lance pas ce fichier.
-- Après 20261009010000_mail_outbox.sql.

alter table public.mail_outbox
  add column if not exists quota_recipients integer not null default 0,
  add column if not exists quota_hour timestamptz,
  add column if not exists quota_day timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mail_outbox_quota_recipients_check'
  ) then
    alter table public.mail_outbox
      add constraint mail_outbox_quota_recipients_check check (quota_recipients >= 0);
  end if;
end $$;

create table if not exists public.mail_quota (
  environment_code text not null,
  window_kind text not null,
  window_start timestamptz not null,
  reserved integer not null default 0,
  primary key (environment_code, window_kind, window_start),
  constraint mail_quota_window_kind_check check (window_kind in ('hour', 'day')),
  constraint mail_quota_reserved_check check (reserved >= 0)
);

create or replace function public.claim_mail_quota(
  p_id uuid,
  p_attempts integer,
  p_recipients integer,
  p_hour_limit integer,
  p_day_limit integer,
  p_hour_start timestamptz,
  p_day_start timestamptz
)
returns setof public.mail_outbox
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.mail_outbox%rowtype;
  v_hour integer;
  v_day integer;
  v_updated integer;
begin
  if p_recipients is null or p_recipients < 1 or p_recipients > 10000
     or p_hour_limit is null or p_hour_limit < 1 or p_hour_limit > 10000
     or p_day_limit is null or p_day_limit < 1 or p_day_limit > 10000
     or p_hour_start is null or p_day_start is null then
    return;
  end if;

  select * into v_row
  from public.mail_outbox
  where id = p_id
  for update;

  if not found
     or v_row.attempts is distinct from p_attempts
     or v_row.attempts >= 3
     or v_row.status not in ('pending', 'failed') then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_row.environment_code));

  insert into public.mail_quota (environment_code, window_kind, window_start, reserved)
  values (v_row.environment_code, 'day', p_day_start, 0)
  on conflict (environment_code, window_kind, window_start) do nothing;

  insert into public.mail_quota (environment_code, window_kind, window_start, reserved)
  values (v_row.environment_code, 'hour', p_hour_start, 0)
  on conflict (environment_code, window_kind, window_start) do nothing;

  select reserved into v_day
  from public.mail_quota
  where environment_code = v_row.environment_code
    and window_kind = 'day'
    and window_start = p_day_start
  for update;

  select reserved into v_hour
  from public.mail_quota
  where environment_code = v_row.environment_code
    and window_kind = 'hour'
    and window_start = p_hour_start
  for update;

  if coalesce(v_hour, 0) + p_recipients > p_hour_limit
     or coalesce(v_day, 0) + p_recipients > p_day_limit then
    update public.mail_outbox
    set last_error = 'Plafond de destinataires atteint',
        updated_at = now()
    where id = p_id
      and status = v_row.status
      and attempt_id is not distinct from v_row.attempt_id
      and status in ('pending', 'failed');
    get diagnostics v_updated = row_count;
    if v_updated = 0 then
      return;
    end if;
    return query
    select * from public.mail_outbox where id = p_id;
    return;
  end if;

  update public.mail_quota
  set reserved = reserved + p_recipients
  where environment_code = v_row.environment_code
    and window_kind = 'day'
    and window_start = p_day_start;

  update public.mail_quota
  set reserved = reserved + p_recipients
  where environment_code = v_row.environment_code
    and window_kind = 'hour'
    and window_start = p_hour_start;

  return query
  update public.mail_outbox
  set status = 'sending',
      attempts = attempts + 1,
      attempt_id = gen_random_uuid(),
      claimed_until = now() + interval '120 seconds',
      quota_recipients = p_recipients,
      quota_hour = p_hour_start,
      quota_day = p_day_start,
      last_error = null,
      updated_at = now()
  where id = p_id
    and attempts = p_attempts
    and status = v_row.status
    and attempt_id is not distinct from v_row.attempt_id
    and status in ('pending', 'failed')
  returning *;
end;
$$;

create or replace function public.finish_mail_outbox(
  p_id uuid,
  p_environment_code text,
  p_attempts integer,
  p_attempt_id uuid,
  p_status text,
  p_last_error text,
  p_warning text,
  p_subject text,
  p_recipients jsonb
)
returns setof public.mail_outbox
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.mail_outbox%rowtype;
begin
  if p_attempt_id is null or p_status not in ('sent', 'failed') then
    return;
  end if;

  update public.mail_outbox
  set status = p_status,
      last_error = p_last_error,
      warning = p_warning,
      subject = p_subject,
      recipients = coalesce(p_recipients, recipients),
      claimed_until = null,
      updated_at = now()
  where id = p_id
    and environment_code = p_environment_code
    and status = 'sending'
    and attempts = p_attempts
    and attempt_id = p_attempt_id
  returning * into v_row;

  if not found then
    return;
  end if;

  if p_status = 'failed' and coalesce(v_row.quota_recipients, 0) > 0 then
    perform pg_advisory_xact_lock(hashtext(v_row.environment_code));
    update public.mail_quota
    set reserved = greatest(0, reserved - v_row.quota_recipients)
    where environment_code = v_row.environment_code
      and window_kind = 'day'
      and window_start is not distinct from v_row.quota_day;
    update public.mail_quota
    set reserved = greatest(0, reserved - v_row.quota_recipients)
    where environment_code = v_row.environment_code
      and window_kind = 'hour'
      and window_start is not distinct from v_row.quota_hour;
    update public.mail_outbox
    set quota_recipients = 0
    where id = v_row.id
      and status = 'failed'
      and attempt_id = p_attempt_id;
    v_row.quota_recipients := 0;
  end if;

  return next v_row;
end;
$$;

alter table public.mail_quota enable row level security;
alter table public.mail_quota force row level security;

revoke all on table public.mail_quota from public;
revoke all on table public.mail_quota from anon;
revoke all on table public.mail_quota from authenticated;
revoke all on function public.claim_mail_quota(uuid, integer, integer, integer, integer, timestamptz, timestamptz) from public;
revoke all on function public.claim_mail_quota(uuid, integer, integer, integer, integer, timestamptz, timestamptz) from anon;
revoke all on function public.claim_mail_quota(uuid, integer, integer, integer, integer, timestamptz, timestamptz) from authenticated;
revoke all on function public.finish_mail_outbox(uuid, text, integer, uuid, text, text, text, text, jsonb) from public;
revoke all on function public.finish_mail_outbox(uuid, text, integer, uuid, text, text, text, text, jsonb) from anon;
revoke all on function public.finish_mail_outbox(uuid, text, integer, uuid, text, text, text, text, jsonb) from authenticated;

grant all on table public.mail_quota to service_role;
grant execute on function public.claim_mail_quota(uuid, integer, integer, integer, integer, timestamptz, timestamptz) to service_role;
grant execute on function public.finish_mail_outbox(uuid, text, integer, uuid, text, text, text, text, jsonb) to service_role;
