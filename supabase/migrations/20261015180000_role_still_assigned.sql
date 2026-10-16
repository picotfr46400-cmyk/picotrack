set lock_timeout = '5s';

-- Trim et minuscules d'un nom de rôle. Même règle que normalizeRoleToken
-- dans api/_access.js : lower(btrim(...)), des deux côtés.

create or replace function public.normalize_role_token(p_value text)
returns text
language sql
immutable
parallel safe
security invoker
set search_path = public
as $$
  select lower(btrim(coalesce(p_value, '')));
$$;

revoke all on function public.normalize_role_token(text) from public;
revoke all on function public.normalize_role_token(text) from anon;
revoke all on function public.normalize_role_token(text) from authenticated;
grant execute on function public.normalize_role_token(text) to service_role;

comment on function public.normalize_role_token(text) is
  'Nom de rôle : trim et minuscules. Exécution réservée à service_role.';

-- Un rôle est-il encore porté dans l'environnement ?
-- normalize_role_token sur role et sur chaque élément de roles.
-- Exécution réservée à service_role.

-- Ne remplace pas une fonction déjà plus récente (normalize_role_name ou role_keys_cap).
do $guard$
begin
  if to_regprocedure('public.role_still_assigned(text,text[])') is not null
     and (
       strpos(pg_get_functiondef('public.role_still_assigned(text,text[])'::regprocedure), 'normalize_role_name') > 0
       or strpos(pg_get_functiondef('public.role_still_assigned(text,text[])'::regprocedure), 'role_keys_cap') > 0
     )
  then
    raise notice 'role_still_assigned deja plus recente, conservation';
    return;
  end if;

  execute $fn$
create or replace function public.role_still_assigned(p_environment_code text, p_role_keys text[])
returns table (assigned boolean)
language sql
stable
security invoker
set search_path = public
as $body$
  with keys as (
    select public.normalize_role_token(key) as key
    from unnest(coalesce(p_role_keys, array[]::text[])) as key
    where public.normalize_role_token(key) <> ''
  )
  select exists (
    select 1
    from public.user_profiles as account
    where upper(btrim(coalesce(account.environment_code, ''))) = upper(btrim(coalesce(p_environment_code, '')))
      and (
        public.normalize_role_token(account.role) in (select key from keys)
        or exists (
          select 1
          from jsonb_array_elements_text(
            case when jsonb_typeof(account.roles) = 'array' then account.roles else '[]'::jsonb end
          ) as elem(value)
          where public.normalize_role_token(elem.value) in (select key from keys)
        )
      )
    union all
    select 1
    from public.licenses as account
    where upper(btrim(coalesce(account.environment_code, ''))) = upper(btrim(coalesce(p_environment_code, '')))
      and (
        public.normalize_role_token(account.role) in (select key from keys)
        or exists (
          select 1
          from jsonb_array_elements_text(
            case when jsonb_typeof(account.roles) = 'array' then account.roles else '[]'::jsonb end
          ) as elem(value)
          where public.normalize_role_token(elem.value) in (select key from keys)
        )
      )
  ) as assigned;
$body$
$fn$;

  execute 'revoke all on function public.role_still_assigned(text, text[]) from public';
  execute 'revoke all on function public.role_still_assigned(text, text[]) from anon';
  execute 'revoke all on function public.role_still_assigned(text, text[]) from authenticated';
  execute 'grant execute on function public.role_still_assigned(text, text[]) to service_role';
  execute $comment$comment on function public.role_still_assigned(text, text[]) is 'EXISTS d''un compte ou d''une licence qui porte le rôle, lower(btrim) sur role et roles. Exécution réservée à service_role.'$comment$;
end
$guard$;
