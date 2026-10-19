set lock_timeout = '5s';

-- RDV (#34, relecture de 19:09) : postérieure à 20261019190000_appointment_booking_scope.sql. Idempotente.
-- - Rejeu d'une clé dont le RDV est annulé : plus de faux succès. Même périmètre (environnement,
--   formulaire, créateur) : la clé est libérée sous verrou et une vraie nouvelle ligne est réservée
--   (capacité comptée normalement, 409 si plein). Autre périmètre : idempotency_conflict, sans donnée.
-- - Comptage et verrou insensibles à la casse et aux espaces de environment_code (déclencheur et RPC).
-- À appliquer à la main, d'abord sur la démo. EFC : voir CHECKLIST-PASSAGE-PROD-EFC.md.

create index if not exists idx_appointments_slot_count_env_ci
  on public.appointments (upper(btrim(environment_code)), form_id, field_id, date, start_time);

create or replace function public.picotrack_appointment_capacity_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  used integer;
  capacity integer;
begin
  -- Capacité serveur, jamais celle de la requête.
  capacity := public.picotrack_appointment_capacity(new.environment_code, new.form_id::text, new.field_id);
  new.parallel_slots := capacity;
  new.capacity_limit := null;
  if not public.picotrack_appointment_is_active(new.status) then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and upper(btrim(new.environment_code)) is not distinct from upper(btrim(old.environment_code))
     and new.form_id is not distinct from old.form_id
     and new.field_id is not distinct from old.field_id
     and new.date is not distinct from old.date
     and new.start_time is not distinct from old.start_time
     and public.picotrack_appointment_is_active(old.status) then
    return new;
  end if;
  perform pg_advisory_xact_lock(public.picotrack_appointment_slot_lock_key(
    upper(btrim(new.environment_code)), new.form_id::text, new.field_id, new.date, new.start_time));
  select count(*) into used
  from public.appointments a
  where upper(btrim(a.environment_code)) = upper(btrim(new.environment_code))
    and a.form_id is not distinct from new.form_id
    and a.field_id is not distinct from new.field_id
    and a.date = new.date
    and a.start_time = new.start_time
    and a.id <> new.id
    and public.picotrack_appointment_is_active(a.status);
  if used >= capacity then
    raise exception 'Créneau complet' using errcode = 'PT409', detail = format('%s/%s', used, capacity);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_picotrack_appointment_capacity on public.appointments;
create trigger trg_picotrack_appointment_capacity
  before insert or update on public.appointments
  for each row execute function public.picotrack_appointment_capacity_guard();

create or replace function public.picotrack_book_appointment(p_record jsonb, p_created_by text, p_idempotency_key text default null)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  r public.appointments;
  existing public.appointments;
  saved public.appointments;
  used integer;
  capacity integer;
  creator text := nullif(btrim(coalesce(p_created_by, '')), '');
  key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
begin
  r := jsonb_populate_record(null::public.appointments, p_record);
  if r.environment_code is null or r.date is null or r.start_time is null or r.form_id is null or r.field_id is null or creator is null then
    raise exception 'Rendez-vous incomplet' using errcode = '22023';
  end if;
  r.environment_code := upper(btrim(r.environment_code));
  capacity := public.picotrack_appointment_capacity(r.environment_code, r.form_id::text, r.field_id);
  perform pg_advisory_xact_lock(public.picotrack_appointment_slot_lock_key(
    r.environment_code, r.form_id::text, r.field_id, r.date, r.start_time));
  if key is not null then
    -- Verrou sur la clé aussi : deux rejeux simultanés de créneaux différents ne se croisent pas.
    perform pg_advisory_xact_lock(hashtextextended('pt-appt-key|' || r.environment_code || '|' || key, 0));
    select * into existing from public.appointments a
    where upper(btrim(a.environment_code)) = r.environment_code and a.idempotency_key = key
    limit 1;
    if found then
      if existing.form_id is distinct from r.form_id or existing.created_by is distinct from creator then
        return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
      end if;
      if public.picotrack_appointment_is_active(existing.status) then
        return jsonb_build_object('ok', true, 'duplicate', true, 'row', jsonb_build_object('id', existing.id, 'status', existing.status));
      end if;
      -- Rendez-vous annulé du même périmètre : la clé est libérée (sous les deux verrous) et une vraie
      -- nouvelle ligne est réservée ci-dessous, avec le comptage normal. Jamais de succès sans ligne active.
      update public.appointments set idempotency_key = null where id = existing.id;
    end if;
  end if;
  select count(*) into used
  from public.appointments a
  where upper(btrim(a.environment_code)) = r.environment_code
    and a.form_id is not distinct from r.form_id
    and a.field_id is not distinct from r.field_id
    and a.date = r.date
    and a.start_time = r.start_time
    and public.picotrack_appointment_is_active(a.status);
  if used >= capacity then
    return jsonb_build_object('ok', false, 'code', 'slot_full', 'used', used, 'capacity', capacity);
  end if;
  insert into public.appointments (
    environment_code, form_id, field_id, response_id, title, customer_name, date, start_time, end_time,
    status, assigned_team, capacity_group, parallel_slots, idempotency_key, created_by
  ) values (
    r.environment_code, r.form_id, r.field_id, r.response_id, r.title, r.customer_name, r.date, r.start_time,
    coalesce(r.end_time, r.start_time), coalesce(r.status, 'confirmed'), r.assigned_team, r.field_id, capacity, key, creator
  )
  returning * into saved;
  return jsonb_build_object('ok', true, 'duplicate', false, 'row', to_jsonb(saved), 'used', used + 1, 'capacity', capacity);
end;
$$;

revoke all on function public.picotrack_book_appointment(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.picotrack_book_appointment(jsonb, text, text) to service_role;
