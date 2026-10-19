set lock_timeout = '5s';

-- Lecture seule des identifiants courts d'un environnement.
-- lower(trim()) des deux côtés : la casse stockée ne change pas, et * , ( ) "
-- restent des caractères littéraux. Au plus deux lignes, triées par id.
-- Exécution réservée à service_role. Invoker : le rôle appelant porte les droits.

create or replace function public.match_short_logins(p_environment_code text, p_login text)
returns table (
  id uuid,
  email text,
  login_user text,
  username text,
  environment_code text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    up.id,
    up.email,
    up.login_user,
    up.username,
    up.environment_code
  from public.user_profiles as up
  where upper(btrim(coalesce(up.environment_code, ''))) = upper(btrim(coalesce(p_environment_code, '')))
    and btrim(coalesce(p_login, '')) <> ''
    and (
      lower(btrim(coalesce(up.login_user, ''))) = lower(btrim(p_login))
      or lower(btrim(coalesce(up.username, ''))) = lower(btrim(p_login))
    )
  order by up.id
  limit 2;
$$;

revoke all on function public.match_short_logins(text, text) from public;
revoke all on function public.match_short_logins(text, text) from anon;
revoke all on function public.match_short_logins(text, text) from authenticated;
grant execute on function public.match_short_logins(text, text) to service_role;

comment on function public.match_short_logins(text, text) is
  'Identifiants courts d''un environnement. Égalité lower(trim) littérale, deux lignes au plus. Exécution réservée à service_role.';
