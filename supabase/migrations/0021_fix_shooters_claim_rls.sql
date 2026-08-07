-- =====================================================================
-- HitFactor — Fix de la RLS de UPDATE sobre shooters (#195)
-- =====================================================================
-- La policy `shooters_claim_self` de la 0001 quedó así:
--
--   using       (auth.role() = 'authenticated')
--   with check  (linked_user_id is null or linked_user_id = auth.uid())
--
-- `using` decide QUÉ FILAS se pueden actualizar; `with check` decide CÓMO
-- PUEDEN QUEDAR después. Al dejar `using` en "cualquier autenticado", todo
-- usuario logueado podía hacer UPDATE sobre CUALQUIER fila de shooters
-- pegándole directo a PostgREST con la anon key — que es pública y viaja
-- en el bundle del browser.
--
-- Dos consecuencias:
--
--   1. Robo de identidad. El `with check` acepta explícitamente
--      `linked_user_id is null`, así que se podía desvincular el shooter
--      de otra persona (queda libre) y después claimearlo por el flujo
--      normal, llevándose todo su historial.
--   2. Vandalismo: full_name / member_number / region de cualquier
--      shooter eran editables por cualquiera.
--
-- El código de app estaba bien (`claimShooter` usa `.is(linked_user_id,
-- null)` y `unclaimShooter` usa `.eq(linked_user_id, userId)`), pero el
-- atacante no pasa por el código de app. La defensa va acá.
--
-- ---------------------------------------------------------------------
-- Por qué `to authenticated` y no `auth.role() = 'authenticated'` en el
-- predicado:
--
-- No es sólo estilo. Si el `using` fuera únicamente el predicado de
-- ownership, un request ANÓNIMO tendría `auth.uid()` en null y evaluaría
-- `linked_user_id is null` → TRUE para todo shooter sin claimear. O sea:
-- arreglaríamos el robo de identidad y abriríamos la edición anónima de
-- los tiradores libres. `to authenticated` cierra eso antes de mirar
-- filas, y encima Postgres lo evalúa una vez por query en vez de una vez
-- por fila.
--
-- ---------------------------------------------------------------------
-- Verificado que no rompe el import: las únicas dos operaciones UPDATE
-- sobre `shooters` en todo el código son `claimShooter` y
-- `unclaimShooter` (src/lib/db/shooters.ts), ambas sobre `linked_user_id`.
-- `resolveShootersBulk` y `findOrCreateShooter`
-- (src/lib/import/shooter-resolution.ts) sólo hacen SELECT e INSERT.
--
-- ---------------------------------------------------------------------
-- Residual conocido: un autenticado sigue pudiendo editar cualquier
-- columna de un shooter SIN CLAIMEAR, porque el claim necesita
-- justamente poder tocar esas filas y la RLS no soporta restricciones por
-- columna. Ya no hay robo de identidad ni edición de datos ajenos
-- claimeados, que era lo grave. Cerrarlo del todo pide un trigger
-- BEFORE UPDATE que congele todo menos `linked_user_id`; se evalúa
-- aparte para no meter superficie nueva en un fix de seguridad.
-- =====================================================================

drop policy if exists "shooters_claim_self" on public.shooters;

create policy "shooters_claim_self"
  on public.shooters for update
  to authenticated
  using (
    -- Filas sobre las que puedo actuar: las libres (para claimear) y las
    -- que ya son mías (para editar o desvincular). Las de otro, no.
    linked_user_id is null
    or linked_user_id = (select auth.uid())
  )
  with check (
    -- Estados en los que puedo dejarlas: libre (unclaim propio) o mía.
    -- Nunca linkeada a un tercero.
    linked_user_id is null
    or linked_user_id = (select auth.uid())
  );

comment on table public.shooters is
  'Identidades de tiradores tal como aparecen en las planillas. UPDATE restringido por RLS a filas sin claimear o propias — ver 0021.';
