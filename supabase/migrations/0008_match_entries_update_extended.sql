-- =====================================================================
-- HitFactor — Ampliación de RLS update sobre match_entries
-- =====================================================================
-- Para que el flujo de "marcar/desmarcar ausencia" funcione, además del
-- importador del match (caso original, único permitido para upserts del
-- re-upload), se necesita autorización a:
--   (b) Administradores del sitio (`profiles.is_admin = true`).
--   (c) El tirador mismo, vía `shooters.linked_user_id = auth.uid()`.
--
-- La policy es UNA — RLS evalúa el OR de las condiciones. Mantenemos el
-- nombre `match_entries_update_match_owner` para no romper grants ni
-- migraciones futuras que lo referencien; el comentario explica el alcance.
--
-- IMPORTANTE: las app actions filtran qué columnas se pueden actualizar
-- por cada rol (el botón "ausente" solo manda `is_absent`). La RLS no
-- hace column-level checks, así que la disciplina vive en server-side.
-- =====================================================================

drop policy if exists "match_entries_update_match_owner" on public.match_entries;

create policy "match_entries_update_match_owner"
  on public.match_entries for update
  using (
    -- (a) Importador del match — caso original, indispensable para upserts.
    exists (
      select 1 from public.matches m
      where m.id = match_id and m.imported_by_user_id = auth.uid()
    )
    -- (b) Admin del sitio.
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin = true
    )
    -- (c) El propio tirador (cualquier shooter linkeado a su user).
    or exists (
      select 1 from public.shooters s
      where s.id = shooter_id and s.linked_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.matches m
      where m.id = match_id and m.imported_by_user_id = auth.uid()
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin = true
    )
    or exists (
      select 1 from public.shooters s
      where s.id = shooter_id and s.linked_user_id = auth.uid()
    )
  );
