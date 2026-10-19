set lock_timeout = '5s';

-- Réservation : capacité lue côté serveur, idempotence par périmètre (décisions du manager, #34, 19/10).
-- Postérieure à 20261019180000_appointment_atomic_booking.sql.
-- Idempotente : add column if not exists, create or replace, drop ... if exists. Aucune ligne n'est réécrite.
-- À appliquer à la main, d'abord sur la démo. EFC : voir CHECKLIST-PASSAGE-PROD-EFC.md.
--
-- - Capacité : lue dans la configuration du créneau (champ « Prise de rendez-vous » du formulaire :
--   parallelSlots, sinon parallel_slots / capacity / capacite / places, défaut 2 comme l'écran).
--   Toute valeur envoyée (parallel_slots, capacity_limit) est ignorée et réécrite.
-- - Idempotence : la clé est rattachée à (environnement, formulaire, créateur). Une clé connue dans un autre
--   périmètre répond « idempotency_conflict » sans aucune donnée ; un rejeu légitime ne rend que id et statut.

alter table public.appointments add column if not exists created_by text;

create or replace function public.picotrack_appointment_capacity(p_environment_code text, p_form_id text, p_field_id text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select greatest(1, least(500, (
      case when coalesce(f->>'parallelSlots', f->>'parallel_slots', f->>'capacity', f->>'capacite', f->>'places', '') ~ '^\s*\d{1,4}\s*$'
           then btrim(coalesce(f->>'parallelSlots', f->>'parallel_slots', f->>'capacity', f->>'capacite', f->>'places'))::integer
           else 2 end)))
    from public.forms fo
    cross join lateral jsonb_array_elements(case when jsonb_typeof(fo.fields) = 'array' then fo.fields else '[]'::jsonb end) f
    where fo.id::text = p_form_id
      and upper(btrim(coalesce(fo.environment_code, ''))) = upper(btrim(coalesce(p_environment_code, '')))
      and f->>'id' = p_field_id
    limit 1
  ), 2);
$$;

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
     and new.environment_code is not distinct from old.environment_code
     and new.form_id is not distinct from old.form_id
     and new.field_id is not distinct from old.field_id
     and new.date is not distinct from old.date
     and new.start_time is not distinct from old.start_time
     and public.picotrack_appointment_is_active(old.status) then
    return new;
  end if;
  perform pg_advisory_xact_lock(public.picotrack_appointment_slot_lock_key(
    new.environment_code, new.form_id::text, new.field_id, new.date, new.start_time));
  select count(*) into used
  from public.appointments a
  where a.environment_code = new.environment_code
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

-- L'ancienne signature acceptait une capacité venue du client : supprimée.
drop function if exists public.picotrack_book_appointment(jsonb, integer, text);

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
    where a.environment_code = r.environment_code and a.idempotency_key = key
    limit 1;
    if found then
      if existing.form_id is not distinct from r.form_id and existing.created_by is not distinct from creator then
        return jsonb_build_object('ok', true, 'duplicate', true, 'row', jsonb_build_object('id', existing.id, 'status', existing.status));
      end if;
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
  end if;
  select count(*) into used
  from public.appointments a
  where a.environment_code = r.environment_code
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
revoke all on function public.picotrack_appointment_capacity(text, text, text) from public, anon, authenticated;
grant execute on function public.picotrack_appointment_capacity(text, text, text) to service_role;
