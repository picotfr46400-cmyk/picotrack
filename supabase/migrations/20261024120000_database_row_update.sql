set lock_timeout = '5s';

-- Actions « Modifier une ligne dans une base » et « Supprimer une ligne dans une base » (bases autonomes de Données).
-- Postérieure à 20261023120000_printer_connections.sql.
-- Idempotente : add column if not exists, create ... if not exists, create or replace. Aucune ligne n'est réécrite.
-- À appliquer à la main, d'abord sur la démo (ukucbfxyvyvtlglujoht). EFC : voir CHECKLIST-PASSAGE-PROD-EFC.md.
--
-- 1. Lien ligne -> dossier : database_rows.instance_id (le lien ligne -> saisie existe déjà : submission_id).
-- 2. Journal database_row_audit : ancienne et nouvelle valeur de chaque modification ou création.
-- 3. Corbeille database_rows_trash : copie complète d'une ligne supprimée en mode « corbeille » (restaurable).
-- 4. picotrack_apply_database_row_action : recherche (ligne liée ou critères ET), verrou, règle « plusieurs lignes »,
--    modification / création / suppression et journal dans une seule transaction.
--    Appelée uniquement par le serveur (service_role) après contrôle des droits dans /api/records (action db_row_update).

alter table public.database_rows add column if not exists instance_id text;
alter table public.database_rows add column if not exists updated_at timestamptz;
create index if not exists idx_database_rows_env_db_instance
  on public.database_rows (environment_code, database_id, instance_id)
  where instance_id is not null;
create index if not exists idx_database_rows_env_db_submission
  on public.database_rows (environment_code, database_id, submission_id)
  where submission_id is not null;

create table if not exists public.database_row_audit (
  id bigserial primary key,
  environment_code text not null,
  database_id text not null,
  row_id bigint,
  operation text not null,
  instance_id text,
  submission_id text,
  context jsonb not null default '{}'::jsonb,
  actor_id uuid,
  actor_label text,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);
alter table public.database_row_audit drop constraint if exists database_row_audit_operation_check;
alter table public.database_row_audit add constraint database_row_audit_operation_check
  check (operation in ('update', 'create', 'delete', 'archive'));
create index if not exists idx_database_row_audit_env_row
  on public.database_row_audit (environment_code, database_id, row_id, created_at desc);
alter table public.database_row_audit enable row level security;
revoke all on table public.database_row_audit from public, anon, authenticated;
grant select, insert on table public.database_row_audit to service_role;
do $$
begin
  if exists (select 1 from pg_class where relname = 'database_row_audit_id_seq') then
    execute 'grant usage on sequence public.database_row_audit_id_seq to service_role';
  end if;
end $$;

create table if not exists public.database_rows_trash (
  id bigint primary key,
  environment_code text not null,
  database_id text not null,
  source text,
  form_id text,
  submission_id text,
  instance_id text,
  "values" jsonb,
  created_at timestamptz,
  tenant_id uuid,
  deleted_at timestamptz not null default now(),
  deleted_by uuid,
  deleted_by_label text
);
alter table public.database_rows_trash add column if not exists tenant_id uuid;
create index if not exists idx_database_rows_trash_env_db
  on public.database_rows_trash (environment_code, database_id, deleted_at desc);
alter table public.database_rows_trash enable row level security;
revoke all on table public.database_rows_trash from public, anon, authenticated;
grant select, insert, delete on table public.database_rows_trash to service_role;

-- Première version (jamais promue) remplacée par picotrack_apply_database_row_action.
drop function if exists public.picotrack_update_database_row(text, text, text, text, text[], text, text, jsonb, text, uuid, text, jsonb);

-- Résultat : {status: updated|created|deleted|none|multiple, count, row_ids, row_id, old_values, new_values}.
-- p_on_multiple : stop (rien n'est écrit, défaut), oldest (la plus ancienne ligne), all (toutes les lignes).
-- p_delete_mode : archive (copie dans database_rows_trash + journal), purge (journal seul avec l'ancienne valeur).
create or replace function public.picotrack_apply_database_row_action(
  p_environment_code text,
  p_database_id text,
  p_operation text,
  p_mode text,
  p_instance_id text,
  p_submission_ids text[],
  p_criteria jsonb,
  p_updates jsonb,
  p_if_none text,
  p_on_multiple text,
  p_delete_mode text,
  p_actor_id uuid,
  p_actor_label text,
  p_context jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  env text := upper(btrim(coalesce(p_environment_code, '')));
  db text := btrim(coalesce(p_database_id, ''));
  op text := lower(btrim(coalesce(p_operation, '')));
  mode text := lower(btrim(coalesce(p_mode, '')));
  on_multiple text := lower(btrim(coalesce(p_on_multiple, 'stop')));
  delete_mode text := lower(btrim(coalesce(p_delete_mode, 'archive')));
  updates jsonb := coalesce(p_updates, '{}'::jsonb);
  criteria jsonb := coalesce(p_criteria, '[]'::jsonb);
  inst text := nullif(btrim(coalesce(p_instance_id, '')), '');
  sub_ids text[] := coalesce(p_submission_ids, array[]::text[]);
  ctx jsonb := coalesce(p_context, '{}'::jsonb);
  ids bigint[];
  target public.database_rows%rowtype;
  next_values jsonb;
  created_id bigint;
  c jsonb;
  done_ids bigint[] := array[]::bigint[];
  first_old jsonb;
  first_new jsonb;
begin
  if env = '' or env = 'GLOBAL' or db = '' then
    raise exception 'Environnement ou base manquant' using errcode = '22023';
  end if;
  if op not in ('update', 'delete') then
    raise exception 'Opération inconnue' using errcode = '22023';
  end if;
  if mode not in ('linked', 'key') then
    raise exception 'Mode de recherche inconnu' using errcode = '22023';
  end if;
  if on_multiple not in ('stop', 'oldest', 'all') then
    raise exception 'Règle « plusieurs lignes » inconnue' using errcode = '22023';
  end if;
  if delete_mode not in ('archive', 'purge') then
    raise exception 'Mode de suppression inconnu' using errcode = '22023';
  end if;
  if jsonb_typeof(updates) <> 'object' or jsonb_typeof(criteria) <> 'array' then
    raise exception 'Paramètres invalides' using errcode = '22023';
  end if;
  if op = 'update' and updates = '{}'::jsonb then
    raise exception 'Aucune colonne à modifier' using errcode = '22023';
  end if;
  if mode = 'linked' and inst is null and cardinality(sub_ids) = 0 then
    raise exception 'Dossier lié manquant' using errcode = '22023';
  end if;
  if mode = 'key' then
    if jsonb_array_length(criteria) = 0 or jsonb_array_length(criteria) > 10 then
      raise exception 'Critères de recherche manquants' using errcode = '22023';
    end if;
    for c in select * from jsonb_array_elements(criteria) loop
      if jsonb_typeof(c) <> 'object' or coalesce(btrim(c ->> 'column'), '') = '' or coalesce(btrim(c ->> 'value'), '') = '' then
        raise exception 'Clé de recherche vide' using errcode = '22023';
      end if;
    end loop;
  end if;

  -- Sérialise les actions concurrentes sur la même base (évite deux créations « si absente »).
  perform pg_advisory_xact_lock(hashtextextended(concat_ws('|', 'pt-dbrow', env, db), 0));

  select array_agg(r.id order by r.created_at nulls last, r.id) into ids
  from public.database_rows r
  where upper(r.environment_code) = env
    and r.database_id = db
    and (
      (mode = 'linked' and (
        (inst is not null and r.instance_id = inst)
        or (r.instance_id is null and r.submission_id = any(sub_ids))
      ))
      or (mode = 'key' and not exists (
        select 1 from jsonb_array_elements(criteria) k
        where btrim(coalesce(r."values" ->> (k ->> 'column'), '')) <> btrim(k ->> 'value')
      ))
    );

  if coalesce(cardinality(ids), 0) > 1 then
    if on_multiple = 'stop' then
      return jsonb_build_object('status', 'multiple', 'count', cardinality(ids));
    elsif on_multiple = 'oldest' then
      ids := ids[1:1];
    end if;
  end if;

  if coalesce(cardinality(ids), 0) = 0 then
    if op = 'delete' or lower(coalesce(p_if_none, '')) <> 'create' then
      return jsonb_build_object('status', 'none', 'count', 0);
    end if;
    next_values := '{}'::jsonb;
    if mode = 'key' then
      select coalesce(jsonb_object_agg(k ->> 'column', btrim(k ->> 'value')), '{}'::jsonb) into next_values
      from jsonb_array_elements(criteria) k;
    end if;
    next_values := next_values || updates;
    insert into public.database_rows (database_id, environment_code, source, instance_id, submission_id, "values")
    values (db, env, 'action:' || left(coalesce(ctx ->> 'action_label', 'modifier une ligne'), 120),
            inst, case when cardinality(sub_ids) > 0 then sub_ids[1] else null end, next_values)
    returning id into created_id;
    insert into public.database_row_audit (environment_code, database_id, row_id, operation, instance_id, submission_id, context, actor_id, actor_label, old_values, new_values)
    values (env, db, created_id, 'create', inst, case when cardinality(sub_ids) > 0 then sub_ids[1] else null end,
            ctx, p_actor_id, p_actor_label, null, next_values);
    return jsonb_build_object('status', 'created', 'count', 1, 'row_id', created_id, 'row_ids', jsonb_build_array(created_id),
                              'old_values', null, 'new_values', next_values);
  end if;

  for target in select * from public.database_rows where id = any(ids) order by created_at nulls last, id for update loop
    if op = 'update' then
      next_values := coalesce(target."values", '{}'::jsonb) || updates;
      update public.database_rows
         set "values" = next_values,
             updated_at = now(),
             instance_id = case when mode = 'linked' then coalesce(instance_id, inst) else instance_id end
       where id = target.id;
      insert into public.database_row_audit (environment_code, database_id, row_id, operation, instance_id, submission_id, context, actor_id, actor_label, old_values, new_values)
      values (env, db, target.id, 'update', inst, target.submission_id, ctx, p_actor_id, p_actor_label, coalesce(target."values", '{}'::jsonb), next_values);
    else
      next_values := null;
      if delete_mode = 'archive' then
        insert into public.database_rows_trash (id, environment_code, database_id, source, form_id, submission_id, instance_id, "values", created_at, tenant_id, deleted_by, deleted_by_label)
        values (target.id, target.environment_code, target.database_id, target.source, target.form_id, target.submission_id, target.instance_id,
                target."values", target.created_at, target.tenant_id, p_actor_id, p_actor_label)
        on conflict (id) do update set "values" = excluded."values", deleted_at = now(), deleted_by = excluded.deleted_by, deleted_by_label = excluded.deleted_by_label;
      end if;
      delete from public.database_rows where id = target.id;
      insert into public.database_row_audit (environment_code, database_id, row_id, operation, instance_id, submission_id, context, actor_id, actor_label, old_values, new_values)
      values (env, db, target.id, case when delete_mode = 'archive' then 'archive' else 'delete' end, inst, target.submission_id, ctx, p_actor_id, p_actor_label, coalesce(target."values", '{}'::jsonb), null);
    end if;
    if first_old is null then first_old := coalesce(target."values", '{}'::jsonb); first_new := next_values; end if;
    done_ids := done_ids || target.id;
  end loop;

  return jsonb_build_object('status', case when op = 'update' then 'updated' else 'deleted' end,
                            'count', cardinality(done_ids), 'row_id', done_ids[1], 'row_ids', to_jsonb(done_ids),
                            'old_values', first_old, 'new_values', first_new);
end;
$$;

revoke all on function public.picotrack_apply_database_row_action(text, text, text, text, text, text[], jsonb, jsonb, text, text, text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.picotrack_apply_database_row_action(text, text, text, text, text, text[], jsonb, jsonb, text, text, text, uuid, text, jsonb) to service_role;
