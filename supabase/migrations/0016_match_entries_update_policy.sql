-- UPDATE policies para match_entries y stage_results.
--
-- Hasta ahora estas tablas tenían policies de SELECT e INSERT, pero ningún
-- policy de UPDATE. Postgres deniega por defecto cuando RLS está habilitado
-- y no hay policy aplicable, así que cualquier UPDATE fallaba.
--
-- Esto se hizo evidente al implementar el re-upload merge: Supabase ejecuta
-- `upsert` como `INSERT ... ON CONFLICT DO UPDATE`, y cuando un entry/result
-- ya existía el branch UPDATE chocaba contra RLS.
--
-- Regla: el dueño del match (imported_by_user_id) puede actualizar los
-- entries/results del match. Esto es consistente con las policies de INSERT
-- existentes.

create policy "match_entries_update_match_owner"
  on public.match_entries for update
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_id and m.imported_by_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.matches m
      where m.id = match_id and m.imported_by_user_id = auth.uid()
    )
  );

create policy "stage_results_update_match_owner"
  on public.stage_results for update
  using (
    exists (
      select 1 from public.stages s
      join public.matches m on m.id = s.match_id
      where s.id = stage_id and m.imported_by_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.stages s
      join public.matches m on m.id = s.match_id
      where s.id = stage_id and m.imported_by_user_id = auth.uid()
    )
  );
