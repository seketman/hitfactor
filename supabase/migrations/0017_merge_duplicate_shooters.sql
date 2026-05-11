-- Merge de tiradores duplicados.
--
-- Causa raíz: `findOrCreateShooter` busca con `ilike(full_name)` + `maybeSingle()`.
-- Si en la DB hay más de una fila con el mismo nombre (creadas en imports
-- anteriores con whitespace/encoding distintos), `maybeSingle()` devuelve null
-- silenciosamente y el flujo termina creando un shooter nuevo.
--
-- Con el upsert de match_entries (Tanda 1) este bug se hizo visible: el
-- re-import resuelve a un shooter_id distinto al original y el upsert no
-- choca (la unique constraint es por shooter_id), así que el match termina
-- mostrando al mismo tirador dos veces — una fila vieja (sin hits) y una
-- nueva (con hits).
--
-- Esta función mergea cada grupo de duplicados a un shooter canónico:
--   - Canónico: prefiere uno con `linked_user_id NOT NULL` (preserva claims),
--     si no, el más antiguo.
--   - Match_entries del canónico: cuando coexisten con un entry duplicado
--     para el mismo (match, división), nos quedamos con el row que tenga
--     más datos (hits IS NOT NULL gana).
--   - Stage_results y firearm logs cascadean automáticamente con
--     match_entries.
--
-- Idempotente: si no hay duplicados, no hace nada. Se puede correr varias
-- veces sin efecto secundario.

create or replace function public.merge_duplicate_shooters()
returns table (canonical_id uuid, duplicate_id uuid, entries_repointed int, entries_deleted int)
language plpgsql
as $$
declare
  grp record;
  dup_id uuid;
  dup_entry record;
  canon_entry_id uuid;
  canon_entry_hits smallint;
  repointed int;
  deleted int;
begin
  for grp in
    with ranked as (
      select
        id,
        lower(btrim(full_name)) as norm_name,
        member_number,
        row_number() over (
          partition by lower(btrim(full_name)), member_number
          order by (linked_user_id is not null) desc, created_at asc
        ) as rn
      from public.shooters
    )
    select
      norm_name,
      member_number,
      (select id from ranked r2 where r2.norm_name = r1.norm_name
        and (r2.member_number is not distinct from r1.member_number)
        and r2.rn = 1) as canon_id,
      array_agg(id) filter (where rn > 1) as dup_ids
    from ranked r1
    group by norm_name, member_number
    having count(*) > 1
  loop
    foreach dup_id in array grp.dup_ids loop
      repointed := 0;
      deleted := 0;

      for dup_entry in
        select id, match_id, division_id, hits
        from public.match_entries
        where shooter_id = dup_id
      loop
        select id, hits into canon_entry_id, canon_entry_hits
        from public.match_entries
        where shooter_id = grp.canon_id
          and match_id = dup_entry.match_id
          and division_id = dup_entry.division_id;

        if canon_entry_id is null then
          -- Sin conflicto: repuntamos el entry del duplicado al canónico.
          update public.match_entries
            set shooter_id = grp.canon_id
            where id = dup_entry.id;
          repointed := repointed + 1;
        else
          -- Conflicto: hay un row del canónico y un row del duplicado para
          -- el mismo (match, division). Nos quedamos con el más rico:
          -- preferimos el row que tenga hits != null.
          if dup_entry.hits is not null and canon_entry_hits is null then
            -- El duplicado tiene más datos. Borramos el del canónico
            -- (cascadea sus stage_results) y repuntamos el del duplicado.
            delete from public.match_entries where id = canon_entry_id;
            update public.match_entries
              set shooter_id = grp.canon_id
              where id = dup_entry.id;
            repointed := repointed + 1;
          else
            -- El canónico ya tiene un row igual o más rico. Borramos el
            -- del duplicado (cascadea sus stage_results).
            delete from public.match_entries where id = dup_entry.id;
            deleted := deleted + 1;
          end if;
        end if;
      end loop;

      -- Ya no hay match_entries apuntando al duplicado: lo eliminamos.
      delete from public.shooters where id = dup_id;

      canonical_id := grp.canon_id;
      duplicate_id := dup_id;
      entries_repointed := repointed;
      entries_deleted := deleted;
      return next;
    end loop;
  end loop;
end;
$$;

-- Ejecutamos el merge ahora.
select * from public.merge_duplicate_shooters();
