set lock_timeout = '5s';

-- Plafond de p_role_keys et normaliseur d'e-mail.
-- Postérieur à 20261016140000_workflow_step_files.sql.
-- Idempotent : create or replace, aucune ligne n'est réécrite.
-- À appliquer à la main, d'abord sur la démo.
-- Ne pas utiliser normalize_email dans un index : la fonction dépend d'ICU.

create or replace function public.role_still_assigned(p_environment_code text, p_role_keys text[])
returns table (assigned boolean)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if coalesce(cardinality(p_role_keys), 0) > 50 then
    raise exception 'role_keys_cap';
  end if;
  return query
  with keys as (
    select public.normalize_role_name(key) as key
    from unnest(coalesce(p_role_keys, array[]::text[])) as key
    where public.normalize_role_name(key) <> ''
  ),
  accounts as (
    select account.role, account.roles
    from public.user_profiles as account
    where upper(btrim(coalesce(account.environment_code, ''))) = upper(btrim(coalesce(p_environment_code, '')))
    union all
    select account.role, account.roles
    from public.licenses as account
    where upper(btrim(coalesce(account.environment_code, ''))) = upper(btrim(coalesce(p_environment_code, '')))
  )
  select exists (
    select 1
    from accounts
    where public.normalize_role_name(accounts.role) in (select key from keys)
       or exists (
         select 1
         from public.role_names_from_jsonb(accounts.roles) as token
         where token <> ''
           and token in (select key from keys)
       )
  ) as assigned;
end;
$$;

revoke all on function public.role_still_assigned(text, text[]) from public;
revoke all on function public.role_still_assigned(text, text[]) from anon;
revoke all on function public.role_still_assigned(text, text[]) from authenticated;
grant execute on function public.role_still_assigned(text, text[]) to service_role;

comment on function public.role_still_assigned(text, text[]) is
  'EXISTS d''un compte ou d''une licence qui porte le rôle. p_role_keys est plafonné à 50 (role_keys_cap). Exécution réservée à service_role.';

create or replace function public.app_roles_for_actor(p_environment_code text, p_role_keys text[])
returns table (id uuid, name text, permissions jsonb)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if coalesce(cardinality(p_role_keys), 0) > 50 then
    raise exception 'role_keys_cap';
  end if;
  return query
  select role.id, role.name, role.permissions
  from public.app_roles as role
  where upper(btrim(coalesce(role.environment_code, ''))) = upper(btrim(coalesce(p_environment_code, '')))
    and coalesce(role.active, true)
    and exists (
      select 1
      from unnest(coalesce(p_role_keys, array[]::text[])) as key
      where public.normalize_role_name(key) <> ''
        and (
          public.normalize_role_name(role.name) = public.normalize_role_name(key)
          or lower(role.id::text) = public.normalize_role_name(key)
        )
    );
end;
$$;

revoke all on function public.app_roles_for_actor(text, text[]) from public;
revoke all on function public.app_roles_for_actor(text, text[]) from anon;
revoke all on function public.app_roles_for_actor(text, text[]) from authenticated;
grant execute on function public.app_roles_for_actor(text, text[]) to service_role;

comment on function public.app_roles_for_actor(text, text[]) is
  'Rôles actifs de l''acteur, normalize_role_name des deux côtés. p_role_keys est plafonné à 50 (role_keys_cap). Exécution réservée à service_role.';

-- Même forme que normalizeEmail : NUL retiré côté JS (un texte Postgres ne peut pas en porter),
-- bords Unicode, NFKC, lower ICU, 320 caractères. Ne pas utiliser normalize_email dans un index.

create or replace function public.normalize_email(p_value text)
returns text
language sql
immutable
parallel safe
security invoker
set search_path = public
as $$
  select left(
    lower(
      normalize(
        regexp_replace(
          coalesce(p_value, ''),
          U&'^[\0009\000A\000B\000C\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+|[\0009\000A\000B\000C\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+$',
          '',
          'g'
        ),
        nfkc
      ) collate "und-x-icu"
    ),
    320
  );
$$;

revoke all on function public.normalize_email(text) from public;
revoke all on function public.normalize_email(text) from anon;
revoke all on function public.normalize_email(text) from authenticated;
grant execute on function public.normalize_email(text) to service_role;

comment on function public.normalize_email(text) is
  'E-mail canonique : bords Unicode, NFKC, lower ICU, 320 caractères. Ne pas utiliser normalize_email dans un index : la fonction dépend d''ICU. Exécution réservée à service_role.';
