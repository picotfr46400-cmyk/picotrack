-- Fichiers d'une étape de workflow, écrits avant l'événement qui les référence.
-- À appliquer à la main, une base client à la fois. L'application ne lance pas ce fichier.
-- La clé d'idempotence est propre à chaque fichier. NULL n'est pas utilisé.
-- Ce fichier est postérieur à 20261009150000_mail_uncertain_release.sql.

create extension if not exists pgcrypto;

create table if not exists public.workflow_step_files (
  id uuid primary key default gen_random_uuid(),
  environment_code text not null,
  idempotency_key text not null,
  step_key text,
  kind text,
  name text,
  content text,
  created_at timestamptz not null default now(),
  constraint workflow_step_files_key_len check (char_length(idempotency_key) between 1 and 160),
  constraint workflow_step_files_environment_key_key unique (environment_code, idempotency_key)
);

create index if not exists workflow_step_files_step_key_idx
  on public.workflow_step_files (environment_code, step_key);

alter table public.workflow_step_files enable row level security;
alter table public.workflow_step_files force row level security;

revoke all on table public.workflow_step_files from public;
revoke all on table public.workflow_step_files from anon;
revoke all on table public.workflow_step_files from authenticated;

grant all on table public.workflow_step_files to service_role;
