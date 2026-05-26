-- =====================================================================
-- HitFactor — Utilidades de auditoría y limpieza de matches duplicados
-- =====================================================================
-- Herramientas de mantenimiento para el caso donde un mismo match fue
-- re-importado luego de un cambio de reglas en el parser, generando
-- entries duplicadas que apuntan a shooter_ids distintos (típicamente
-- "Nombre, Apellido" vs "NOMBRE, Apellido #123"). El upsert de import
-- usa onConflict (match_id, shooter_id, division_id), así que no detecta
-- estos casos — las entries viejas quedan stale junto a las nuevas.
--
-- Workflow esperado (admin, vía Supabase SQL editor):
--   1) select * from public.find_matches_with_internal_duplicates();
--      → lista de matches sospechosos.
--   2) select * from public.purge_match_for_reimport('<nombre>', '<fecha>');
--      → borra el match (cascade: entries, stages, stage_results,
--        firearm_logs) y los shooters huérfanos sin claim.
--   3) Re-subir el PDF original por la UI normal.
--
-- Igual que merge_duplicate_shooters(): no es parte del bootstrap del
-- esquema, son utilitarios de reparación. Se incluyen acá para que la DB
-- recreada quede igual a la original.
-- =====================================================================

-- ---------------------------------------------------------------------
-- find_matches_with_internal_duplicates
-- ---------------------------------------------------------------------
-- Lista matches donde, en alguna división, hay dos o más entries cuyo
-- nombre normalizado (lower + collapse whitespace) coincide. La norma
-- es deliberadamente conservadora: detecta los casos donde la única
-- diferencia es mayúsculas/minúsculas o espacios extras (caso típico
-- "FERRARO, Martin Miguel" vs "FERRARO, Martin  Miguel").
--
-- NO detecta typos (LANZILOTTA vs LANZILLOTTA) ni nombres con tokens
-- agregados (Eduardo vs Eduardo Jorge) — esos requieren revisión manual.
-- ---------------------------------------------------------------------
create or replace function public.find_matches_with_internal_duplicates()
returns table (
  match_id uuid,
  match_date date,
  match_name text,
  discipline_code text,
  duplicate_groups int,
  duplicate_names text[]
)
language sql
stable
set search_path = ''
as $$
  select
    m.id                              as match_id,
    m.date                            as match_date,
    m.name                            as match_name,
    d.code                            as discipline_code,
    count(*)::int                     as duplicate_groups,
    array_agg(distinct dup.norm_name) as duplicate_names
  from public.matches m
  join public.disciplines d on d.id = m.discipline_id
  join (
    select
      me.match_id,
      me.division_id,
      pg_catalog.regexp_replace(
        pg_catalog.lower(pg_catalog.btrim(s.full_name)),
        '\s+', ' ', 'g'
      ) as norm_name
    from public.match_entries me
    join public.shooters s on s.id = me.shooter_id
    group by me.match_id, me.division_id,
             pg_catalog.regexp_replace(
               pg_catalog.lower(pg_catalog.btrim(s.full_name)),
               '\s+', ' ', 'g'
             )
    having count(*) > 1
  ) dup on dup.match_id = m.id
  group by m.id, m.date, m.name, d.code
  order by m.date desc;
$$;

comment on function public.find_matches_with_internal_duplicates() is
  'Lista matches con entries duplicadas dentro de la misma división (mismo nombre normalizado, distinto shooter_id). Usar antes de purge_match_for_reimport.';

-- ---------------------------------------------------------------------
-- purge_match_for_reimport
-- ---------------------------------------------------------------------
-- Borra un match identificado por (name, date) con todo lo que cascadea
-- (match_entries → stage_results, match_firearm_log; stages) y limpia los
-- shooters que quedaron huérfanos y sin claim.
--
-- Preserva shooters claimados (linked_user_id is not null) aunque queden
-- sin entries — la identidad del usuario no se pierde, simplemente queda
-- sin matches hasta que se importe otro donde aparezca.
--
-- Levanta excepción si el match no existe (ruidoso a propósito: evita
-- borrados silenciosos por typo en el nombre).
--
-- Después de correr esta función, re-subir el PDF original por la UI.
-- ---------------------------------------------------------------------
create or replace function public.purge_match_for_reimport(
  p_name text,
  p_date date
)
returns table (
  match_id uuid,
  entries_deleted int,
  firearm_logs_deleted int,
  orphan_shooters_deleted int
)
language plpgsql
set search_path = ''
as $$
declare
  v_match_id uuid;
  v_entries int;
  v_firearm_logs int;
  v_orphans int;
begin
  select id into v_match_id
    from public.matches
   where name = p_name and date = p_date;

  if v_match_id is null then
    raise exception 'No se encontró match: % (%)', p_name, p_date;
  end if;

  select count(*)::int into v_entries
    from public.match_entries where match_id = v_match_id;

  select count(*)::int into v_firearm_logs
    from public.match_firearm_log mfl
    join public.match_entries me on me.id = mfl.match_entry_id
   where me.match_id = v_match_id;

  delete from public.matches where id = v_match_id;

  with deleted as (
    delete from public.shooters s
     where s.linked_user_id is null
       and not exists (
         select 1 from public.match_entries me where me.shooter_id = s.id
       )
    returning s.id
  )
  select count(*)::int into v_orphans from deleted;

  match_id := v_match_id;
  entries_deleted := v_entries;
  firearm_logs_deleted := v_firearm_logs;
  orphan_shooters_deleted := v_orphans;
  return next;
end;
$$;

comment on function public.purge_match_for_reimport(text, date) is
  'Borra un match por (name, date) con cascade completo y elimina shooters huérfanos sin claim. Pensado para re-import limpio luego de que un cambio del parser dejara entries stale.';

-- Las dos funciones son utilitarios de admin que se invocan desde el
-- SQL editor de Supabase. No tienen por qué estar expuestas al cliente
-- vía PostgREST — revocamos el EXECUTE público (anon/authenticated lo
-- heredan).
revoke execute on function public.find_matches_with_internal_duplicates()
  from public, anon, authenticated;
revoke execute on function public.purge_match_for_reimport(text, date)
  from public, anon, authenticated;
