set lock_timeout = '5s';

-- Ne pas utiliser normalize_role_name dans un index : la fonction dépend d'ICU.
comment on function public.normalize_role_name(text) is
  'Nom de rôle canonique : NFKC, espaces Unicode, contrôles retirés, lower ICU. Ne pas utiliser normalize_role_name dans un index : la fonction dépend d''ICU. Exécution réservée à service_role.';

-- Catalogue ciblé de l'acteur. normalize_role_name(name) est comparé à
-- normalize_role_name(clé), des deux côtés. L'id est comparé à la même clé
-- canonique. Aucune ligne n'est réécrite.

create or replace function public.app_roles_for_actor(p_environment_code text, p_role_keys text[])
returns table (id uuid, name text, permissions jsonb)
language sql
stable
security invoker
set search_path = public
as $$
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
$$;

revoke all on function public.app_roles_for_actor(text, text[]) from public;
revoke all on function public.app_roles_for_actor(text, text[]) from anon;
revoke all on function public.app_roles_for_actor(text, text[]) from authenticated;
grant execute on function public.app_roles_for_actor(text, text[]) to service_role;

comment on function public.app_roles_for_actor(text, text[]) is
  'Rôles actifs de l''acteur : normalize_role_name(name) = normalize_role_name(clé), des deux côtés. Exécution réservée à service_role.';

-- La vérification et le DELETE tiennent le même verrou. Les écritures de
-- comptes et de licences attendent, puis la ligne du rôle est verrouillée,
-- puis role_still_assigned relit, puis la ligne part si personne ne le porte.

create or replace function public.delete_app_role_if_unassigned(p_id uuid)
returns table (deleted boolean, assigned boolean)
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  role_env text;
  role_name text;
  role_key text;
  still boolean;
begin
  lock table public.user_profiles in share row exclusive mode;
  lock table public.licenses in share row exclusive mode;
  select account.environment_code, account.name, account.id::text
    into role_env, role_name, role_key
    from public.app_roles as account
   where account.id = p_id
   for update;
  if not found then
    deleted := false;
    assigned := false;
    return next;
    return;
  end if;
  select probe.assigned
    into still
    from public.role_still_assigned(role_env, array[role_key, role_name]) as probe;
  if still is null then
    raise exception 'verification du role illisible';
  end if;
  if still then
    deleted := false;
    assigned := true;
    return next;
    return;
  end if;
  delete from public.app_roles where id = p_id;
  deleted := true;
  assigned := false;
  return next;
end;
$$;

revoke all on function public.delete_app_role_if_unassigned(uuid) from public;
revoke all on function public.delete_app_role_if_unassigned(uuid) from anon;
revoke all on function public.delete_app_role_if_unassigned(uuid) from authenticated;
grant execute on function public.delete_app_role_if_unassigned(uuid) to service_role;

comment on function public.delete_app_role_if_unassigned(uuid) is
  'Verrouille comptes, licences et la ligne du rôle, revérifie role_still_assigned, puis supprime. Exécution réservée à service_role.';
