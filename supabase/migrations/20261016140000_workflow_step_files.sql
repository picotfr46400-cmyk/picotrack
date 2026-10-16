set lock_timeout = '5s';

-- Fichiers d'une étape de workflow, écrits avant l'événement qui les référence.
-- À appliquer à la main, d'abord sur la démo, jamais sur EFC.
-- Postérieur à 20261016133000_role_name_lookup.sql.
-- Idempotent : la table peut déjà exister, aucune ligne n'est réécrite.

create extension if not exists pgcrypto;

create table if not exists public.workflow_step_files (
  id uuid primary key default gen_random_uuid(),
  environment_code text not null,
  idempotency_key text not null,
  created_at timestamptz not null default now()
);

alter table public.workflow_step_files add column if not exists step_key text;
alter table public.workflow_step_files add column if not exists kind text;
alter table public.workflow_step_files add column if not exists name text;
alter table public.workflow_step_files add column if not exists content text;
alter table public.workflow_step_files add column if not exists created_at timestamptz not null default now();

alter table public.workflow_step_files drop constraint if exists workflow_step_files_key_len;
alter table public.workflow_step_files
  add constraint workflow_step_files_key_len
  check (idempotency_key is null or char_length(idempotency_key) between 1 and 160);

create unique index if not exists workflow_step_files_environment_key_idx
  on public.workflow_step_files (environment_code, idempotency_key);

create index if not exists workflow_step_files_step_key_idx
  on public.workflow_step_files (environment_code, step_key);

alter table public.workflow_step_files enable row level security;
alter table public.workflow_step_files force row level security;

revoke all on table public.workflow_step_files from public;
revoke all on table public.workflow_step_files from anon;
revoke all on table public.workflow_step_files from authenticated;

grant all on table public.workflow_step_files to service_role;
