-- Mails automatiques PicoTrack.
-- À appliquer à la main, une base client à la fois. L'application ne lance pas ce fichier.
-- Ordre dans le fichier : mail_rules, mail_outbox, claim_mail_outbox, expire_mail_outbox.
-- L'unicité d'idempotence et l'unicité (environment_code, client_key) sont des contraintes complètes, sans prédicat.
-- Ce fichier est postérieur aux migrations du journal de saisie (20261008234500).

create extension if not exists pgcrypto;

create table if not exists public.mail_rules (
  id uuid primary key default gen_random_uuid(),
  environment_code text not null,
  active boolean not null default true,
  event text not null,
  form_id text,
  service_id text,
  status_id text,
  action_key text,
  client_key text not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mail_rules_environment_client_key_key unique (environment_code, client_key)
);

create index if not exists mail_rules_environment_code_idx
  on public.mail_rules (environment_code);

create table if not exists public.mail_outbox (
  id uuid primary key default gen_random_uuid(),
  environment_code text not null,
  rule_id uuid references public.mail_rules (id) on delete set null,
  event text not null,
  target_id text,
  recipients jsonb not null default '{}'::jsonb,
  subject text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  warning text,
  claimed_until timestamptz,
  attempt_id uuid,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mail_outbox_status_check check (status in ('pending', 'sending', 'sent', 'failed', 'skipped', 'uncertain')),
  constraint mail_outbox_attempts_check check (attempts >= 0),
  constraint mail_outbox_idempotency_key_key unique (idempotency_key)
);

create index if not exists mail_outbox_environment_created_idx
  on public.mail_outbox (environment_code, created_at);

create or replace function public.claim_mail_outbox(p_id uuid, p_attempts integer)
returns setof public.mail_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.mail_outbox
  set status = 'sending',
      attempts = attempts + 1,
      attempt_id = gen_random_uuid(),
      claimed_until = now() + interval '120 seconds',
      updated_at = now()
  where id = p_id
    and attempts = p_attempts
    and attempts < 3
    and status in ('pending', 'failed')
  returning *;
end;
$$;

create or replace function public.expire_mail_outbox(p_environment_code text)
returns setof public.mail_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.mail_outbox
  set status = 'uncertain',
      last_error = 'Envoi incertain : le bail a expiré sans confirmation.',
      claimed_until = null,
      updated_at = now()
  where environment_code = p_environment_code
    and status = 'sending'
    and (claimed_until is null or claimed_until < now())
  returning *;
end;
$$;

alter table public.mail_rules enable row level security;
alter table public.mail_rules force row level security;
alter table public.mail_outbox enable row level security;
alter table public.mail_outbox force row level security;

revoke all on table public.mail_rules from public;
revoke all on table public.mail_rules from anon;
revoke all on table public.mail_rules from authenticated;
revoke all on table public.mail_outbox from public;
revoke all on table public.mail_outbox from anon;
revoke all on table public.mail_outbox from authenticated;
revoke all on function public.claim_mail_outbox(uuid, integer) from public;
revoke all on function public.claim_mail_outbox(uuid, integer) from anon;
revoke all on function public.claim_mail_outbox(uuid, integer) from authenticated;
revoke all on function public.expire_mail_outbox(text) from public;
revoke all on function public.expire_mail_outbox(text) from anon;
revoke all on function public.expire_mail_outbox(text) from authenticated;

grant all on table public.mail_rules to service_role;
grant all on table public.mail_outbox to service_role;
grant execute on function public.claim_mail_outbox(uuid, integer) to service_role;
grant execute on function public.expire_mail_outbox(text) to service_role;
