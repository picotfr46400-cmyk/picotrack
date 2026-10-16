set lock_timeout = '5s';

-- Forme canonique d'un nom de rôle. NFKC, espaces Unicode (tabulation,
-- espace insécable, \s et classe Zs) repliés en un espace, caractères de
-- contrôle et invisibles retirés, trim, puis lower. La collation ICU racine
-- fixe le résultat : İ, ı et ß ne dépendent pas de la locale de la base.
-- Aucune ligne n'est réécrite.

create or replace function public.normalize_role_name(p_value text)
returns text
language sql
immutable
parallel safe
security invoker
set search_path = public
as $$
  select lower(btrim(regexp_replace(
    regexp_replace(
      normalize(coalesce(p_value, ''), NFKC),
      U&'[\0009\000A\000B\000C\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',
      ' ',
      'g'
    ),
    '[' || chr(1) || '-' || chr(8) || chr(14) || '-' || chr(31) || chr(127) || '-' || chr(159)
      || chr(173) || chr(1564) || chr(6158)
      || chr(8203) || '-' || chr(8207)
      || chr(8234) || '-' || chr(8238)
      || chr(8288) || '-' || chr(8303)
      || chr(65024) || '-' || chr(65039)
      || chr(65279)
      || chr(65529) || '-' || chr(65531)
      || ']',
    '',
    'g'
  )) COLLATE "und-x-icu");
$$;

revoke all on function public.normalize_role_name(text) from public;
revoke all on function public.normalize_role_name(text) from anon;
revoke all on function public.normalize_role_name(text) from authenticated;
grant execute on function public.normalize_role_name(text) to service_role;

comment on function public.normalize_role_name(text) is
  'Nom de rôle canonique : NFKC, espaces Unicode, contrôles retirés, lower ICU. Exécution réservée à service_role.';

-- Jetons portés par roles, quel que soit le type jsonb : tableau, chaîne,
-- texte JSON, CSV, ou null.

create or replace function public.role_names_from_jsonb(p_value jsonb)
returns setof text
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  raw text;
  part text;
  parsed jsonb;
begin
  if p_value is null then
    return;
  end if;
  if jsonb_typeof(p_value) = 'array' then
    for part in select jsonb_array_elements_text(p_value)
    loop
      return next public.normalize_role_name(part);
    end loop;
    return;
  end if;
  if jsonb_typeof(p_value) = 'string' then
    raw := p_value #>> '{}';
    if left(btrim(raw), 1) = '[' then
      begin
        parsed := btrim(raw)::jsonb;
        if jsonb_typeof(parsed) = 'array' then
          for part in select public.role_names_from_jsonb(parsed)
          loop
            return next part;
          end loop;
          return;
        end if;
      exception
        when others then
          null;
      end;
    end if;
    if position(',' in coalesce(raw, '')) > 0 then
      foreach part in array string_to_array(raw, ',')
      loop
        return next public.normalize_role_name(part);
      end loop;
      return;
    end if;
    return next public.normalize_role_name(raw);
    return;
  end if;
end;
$$;

revoke all on function public.role_names_from_jsonb(jsonb) from public;
revoke all on function public.role_names_from_jsonb(jsonb) from anon;
revoke all on function public.role_names_from_jsonb(jsonb) from authenticated;
grant execute on function public.role_names_from_jsonb(jsonb) to service_role;

comment on function public.role_names_from_jsonb(jsonb) is
  'Jetons canoniques d''une colonne roles jsonb. Exécution réservée à service_role.';

drop function if exists public.role_still_assigned(text, text[]);

create function public.role_still_assigned(p_environment_code text, p_role_keys text[])
returns table (assigned boolean)
language sql
stable
security invoker
set search_path = public
as $$
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
$$;

revoke all on function public.role_still_assigned(text, text[]) from public;
revoke all on function public.role_still_assigned(text, text[]) from anon;
revoke all on function public.role_still_assigned(text, text[]) from authenticated;
grant execute on function public.role_still_assigned(text, text[]) to service_role;

comment on function public.role_still_assigned(text, text[]) is
  'EXISTS d''un compte ou d''une licence qui porte le rôle, normalize_role_name des deux côtés, sur role et roles. Exécution réservée à service_role.';
