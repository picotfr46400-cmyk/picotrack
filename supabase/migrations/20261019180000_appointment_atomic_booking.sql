set lock_timeout = '5s';

-- Réservation de créneau atomique (PR #34, NO-GO relecture du 19/10).
-- Postérieure à 20261016150000_role_key_cap_email.sql.
-- Idempotente : add column if not exists, create or replace, drop ... if exists. Aucune ligne n'est réécrite.
-- À appliquer à la main, d'abord sur la démo (ukucbfxyvyvtlglujoht). EFC : voir CHECKLIST-PASSAGE-PROD-EFC.md.
--
-- Remplace le déclencheur non versionné trg_prevent_appointment_overbooking (DEMO) :
--   - il comptait sans verrou (deux insertions simultanées passaient),
--   - il regroupait par capacity_group, comptait les RDV annulés et bloquait aussi les mises à jour.
-- Le groupe de comptage devient (environnement, formulaire, champ, date, heure), hors annulés,
-- le même que l'écran de saisie et /api/appointments.

alter table public.appointments add column if not exists idempotency_key text;
create unique index if not exists appointments_env_idempotency_key_uidx
  on public.appointments (environment_code, idempotency_key)
  where idempotency_key is not null;
create index if not exists idx_appointments_slot_count
  on public.appointments (environment_code, form_id, field_id, date, start_time);

-- Clé de verrou d'un créneau : environnement + formulaire + champ + date + heure.
create or replace function public.picotrack_appointment_slot_lock_key(
  p_environment_code text, p_form_id text, p_field_id text, p_date date, p_start_time time
)
returns bigint
language sql
immutable
set search_path = public
as $$
  select hashtextextended(concat_ws('|', 'pt-appt', upper(btrim(coalesce(p_environment_code, ''))),
    coalesce(p_form_id, ''), coalesce(p_field_id, ''), coalesce(p_date::text, ''), coalesce(p_start_time::text, '')), 0);
$$;

create or replace function public.picotrack_appointment_is_active(p_status text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(btrim(coalesce(p_status, ''))) not in ('cancelled', 'canceled', 'annule', 'annulé', 'deleted', 'void');
$$;

-- Garde-fou pour toute écriture (même hors RPC) : même verrou, même comptage.
create or replace function public.picotrack_appointment_capacity_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  used integer;
  capacity integer := greatest(1, coalesce(new.parallel_slots, 1));
begin
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

drop trigger if exists trg_prevent_appointment_overbooking on public.appointments;
drop function if exists public.prevent_appointment_overbooking();
drop trigger if exists trg_picotrack_appointment_capacity on public.appointments;
create trigger trg_picotrack_appointment_capacity
  before insert or update on public.appointments
  for each row execute function public.picotrack_appointment_capacity_guard();

-- Réservation : verrou du créneau, rejeu idempotent, comptage hors annulés et insertion dans la même transaction.
-- Retour : {ok:true, row, used, capacity, duplicate} ou {ok:false, code:'slot_full', used, capacity}.
create or replace function public.picotrack_book_appointment(p_record jsonb, p_capacity integer, p_idempotency_key text default null)
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
  capacity integer := greatest(1, coalesce(p_capacity, 1));
  key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
begin
  r := jsonb_populate_record(null::public.appointments, p_record);
  if r.environment_code is null or r.date is null or r.start_time is null or r.form_id is null or r.field_id is null then
    raise exception 'Rendez-vous incomplet' using errcode = '22023';
  end if;
  r.environment_code := upper(btrim(r.environment_code));
  perform pg_advisory_xact_lock(public.picotrack_appointment_slot_lock_key(
    r.environment_code, r.form_id::text, r.field_id, r.date, r.start_time));
  if key is not null then
    select * into existing from public.appointments a
    where a.environment_code = r.environment_code and a.idempotency_key = key
    limit 1;
    if found then
      return jsonb_build_object('ok', true, 'duplicate', true, 'row', to_jsonb(existing), 'capacity', capacity);
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
    status, assigned_team, capacity_group, parallel_slots, idempotency_key
  ) values (
    r.environment_code, r.form_id, r.field_id, r.response_id, r.title, r.customer_name, r.date, r.start_time,
    coalesce(r.end_time, r.start_time), coalesce(r.status, 'confirmed'), r.assigned_team, r.capacity_group, capacity, key
  )
  returning * into saved;
  return jsonb_build_object('ok', true, 'duplicate', false, 'row', to_jsonb(saved), 'used', used + 1, 'capacity', capacity);
exception
  when unique_violation then
    select * into existing from public.appointments a
    where a.environment_code = r.environment_code and a.idempotency_key = key
    limit 1;
    if found then
      return jsonb_build_object('ok', true, 'duplicate', true, 'row', to_jsonb(existing), 'capacity', capacity);
    end if;
    raise;
end;
$$;

revoke all on function public.picotrack_book_appointment(jsonb, integer, text) from public, anon, authenticated;
grant execute on function public.picotrack_book_appointment(jsonb, integer, text) to service_role;
revoke all on function public.picotrack_appointment_capacity_guard() from public, anon, authenticated;
