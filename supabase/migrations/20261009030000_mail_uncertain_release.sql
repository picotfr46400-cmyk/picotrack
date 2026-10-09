-- Rend la place d'un envoi uncertain avant un renvoi manuel.
-- À appliquer à la main, d'abord sur la démo, jamais sur EFC.
-- Après 20261009020000_mail_quota.sql.

create or replace function public.release_uncertain_mail(
  p_id uuid,
  p_environment_code text
)
returns setof public.mail_outbox
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.mail_outbox%rowtype;
begin
  if p_id is null or p_environment_code is null or p_environment_code = '' then
    return;
  end if;

  select * into v_row
  from public.mail_outbox
  where id = p_id
    and environment_code = p_environment_code
  for update;

  if not found or v_row.status is distinct from 'uncertain' then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_row.environment_code));

  if coalesce(v_row.quota_recipients, 0) > 0 then
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
  end if;

  update public.mail_outbox
  set status = 'failed',
      attempts = 0,
      attempt_id = null,
      last_error = null,
      claimed_until = null,
      quota_recipients = 0,
      updated_at = now()
  where id = v_row.id
    and environment_code = p_environment_code
    and status = 'uncertain'
  returning * into v_row;

  if not found then
    return;
  end if;

  return next v_row;
end;
$$;

revoke all on function public.release_uncertain_mail(uuid, text) from public;
revoke all on function public.release_uncertain_mail(uuid, text) from anon;
revoke all on function public.release_uncertain_mail(uuid, text) from authenticated;
grant execute on function public.release_uncertain_mail(uuid, text) to service_role;
