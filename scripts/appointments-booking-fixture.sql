-- Table appointments au format DEMO (19/10/2026) et ancien déclencheur non versionné, pour la CI.
create extension if not exists pgcrypto;
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  form_id bigint, field_id text, response_id bigint, title text, customer_name text,
  date date not null, start_time time not null, end_time time not null,
  status text default 'confirmed', assigned_team text, capacity_group text,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  capacity_limit integer, parallel_slots integer default 1, tenant_id uuid,
  environment_code text not null default 'DEMO'
);
create table if not exists public.forms (id bigint primary key, nom text, fields jsonb, environment_code text);
insert into public.forms (id, nom, environment_code, fields) values
  (4, 'Nouveau formulaire', 'DEMO', '[{"id":1792401253084,"type":"appointment","parallelSlots":2}]'::jsonb),
  (5, 'Autre formulaire', 'DEMO', '[{"id":1792401253084,"type":"appointment","parallelSlots":2}]'::jsonb),
  (4000, 'EFC', 'EFC', '[{"id":1792401253084,"type":"appointment","parallelSlots":1}]'::jsonb)
on conflict (id) do nothing;
create or replace function public.prevent_appointment_overbooking()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare existing_count int;
begin
  select count(*) into existing_count from public.appointments
  where environment_code = new.environment_code and date = new.date and start_time = new.start_time
    and coalesce(capacity_group, '') = coalesce(new.capacity_group, '') and id <> new.id;
  if existing_count >= coalesce(new.parallel_slots, 1) then
    raise exception 'Créneau complet pour cette date et cette heure';
  end if;
  return new;
end; $$;
drop trigger if exists trg_prevent_appointment_overbooking on public.appointments;
create trigger trg_prevent_appointment_overbooking before insert or update on public.appointments
  for each row execute function public.prevent_appointment_overbooking();
