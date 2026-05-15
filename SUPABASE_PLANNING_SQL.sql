create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  form_id bigint,
  field_id text,
  response_id bigint,
  title text,
  customer_name text,
  date date not null,
  start_time time not null,
  end_time time not null,
  status text default 'confirmed',
  assigned_team text,
  capacity_group text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table appointments enable row level security;

drop policy if exists "appointments_select_all" on appointments;
create policy "appointments_select_all"
on appointments for select
using (true);

drop policy if exists "appointments_insert_all" on appointments;
create policy "appointments_insert_all"
on appointments for insert
with check (true);

drop policy if exists "appointments_update_all" on appointments;
create policy "appointments_update_all"
on appointments for update
using (true)
with check (true);

create index if not exists idx_appointments_form_date
on appointments(form_id, date, start_time);
