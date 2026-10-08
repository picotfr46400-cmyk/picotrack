-- Clé d'idempotence des créations PAD.
-- NULL autorisés et distincts : aucune ligne existante n'est réécrite.
-- L'index est plein (pas de WHERE) pour que PostgREST puisse envoyer
-- ON CONFLICT (environment_code, idempotency_key) sans 42P10.
-- Les tables métier peuvent ne pas exister encore au moment du job SQL :
-- chaque ordre est alors ignoré, et reste idempotent une fois les tables là.

alter table if exists public.submissions
  add column if not exists idempotency_key text;

alter table if exists public.submissions
  drop constraint if exists submissions_idempotency_key_len;

alter table if exists public.submissions
  add constraint submissions_idempotency_key_len
  check (idempotency_key is null or char_length(idempotency_key) between 1 and 160);

do $$
begin
  if to_regclass('public.submissions') is not null then
    execute 'create unique index if not exists submissions_idempotency_idx on public.submissions (environment_code, idempotency_key) nulls distinct';
  end if;
end $$;

alter table if exists public.service_instances
  add column if not exists idempotency_key text;

alter table if exists public.service_instances
  drop constraint if exists service_instances_idempotency_key_len;

alter table if exists public.service_instances
  add constraint service_instances_idempotency_key_len
  check (idempotency_key is null or char_length(idempotency_key) between 1 and 160);

do $$
begin
  if to_regclass('public.service_instances') is not null then
    execute 'create unique index if not exists service_instances_idempotency_idx on public.service_instances (environment_code, idempotency_key) nulls distinct';
  end if;
end $$;

do $$
begin
  if to_regclass('public.submissions') is not null then
    execute 'comment on column public.submissions.idempotency_key is ''Clé PAD de création. NULL pour l''''existant. Unique avec environment_code, NULLS DISTINCT.''';
  end if;
  if to_regclass('public.service_instances') is not null then
    execute 'comment on column public.service_instances.idempotency_key is ''Clé PAD de création. NULL pour l''''existant. Unique avec environment_code, NULLS DISTINCT.''';
  end if;
end $$;
