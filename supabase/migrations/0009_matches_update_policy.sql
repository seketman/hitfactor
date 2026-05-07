-- =====================================================================
-- HitFactor — UPDATE policy en matches para el importador
-- =====================================================================
-- La migración 0001 definió SELECT, INSERT y DELETE pero olvidó UPDATE.
-- Con RLS habilitada y sin policy de UPDATE, cualquier intento de
-- actualizar un match se rechaza silenciosamente (afecta 0 filas, sin
-- error). Eso rompía el "Editar club" del match detail.
--
-- Habilita UPDATE solo al importador del match.
-- =====================================================================

create policy "matches_update_importer"
  on public.matches for update
  using (auth.uid() = imported_by_user_id)
  with check (auth.uid() = imported_by_user_id);
