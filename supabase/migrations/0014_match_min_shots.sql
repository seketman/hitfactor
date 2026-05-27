-- =====================================================================
-- HitFactor — Disparos mínimos por match (#75)
-- =====================================================================
-- Cada match tiene una cantidad mínima de disparos definida por las
-- reglas de la disciplina. Comparada contra `match_firearm_log.rounds_fired`
-- nos da los "disparos extra" (fallas + tiros de repaso) que el tirador
-- usó por encima del mínimo. KPI accionable: cuánta munición se "gasta
-- de más" por match en promedio o acumulado.
--
-- Por disciplina:
--   - Tiro FBI: 45 fijo (5 warmup + 8×5 puntuables) → auto-asignado al
--     importar, no editable en el form.
--   - IPSC / Steel Challenge / Combat Solutions: variable por match →
--     el importer lo ingresa en el form.
--
-- RLS: el importer ya puede actualizar matches via `matches_update_importer`.
-- Sumamos `matches_update_admin` para que un admin pueda editar el campo
-- de matches importados por otros (caso de uso: backfill manual de matches
-- viejos importados antes de esta feature).
-- =====================================================================

-- 1) Columna nullable (los matches viejos no tienen el dato, admin completa
--    a mano según convenga; nuevos imports lo pueblan al insertar).
alter table public.matches
  add column min_shots int check (min_shots is null or min_shots > 0);

comment on column public.matches.min_shots is
  'Cantidad mínima de disparos requerida por las reglas de la disciplina. Se compara con match_firearm_log.rounds_fired para calcular "disparos extra". FBI siempre 45 (auto); resto variable y manual al importar.';

-- 2) Backfill: todos los matches FBI ya importados pasan a 45.
--    El resto queda NULL — admin los completa cuando quiera desde la UI.
update public.matches m
set min_shots = 45
from public.disciplines d
where m.discipline_id = d.id
  and d.code = 'tiro_fbi'
  and m.min_shots is null;

-- 3) Policy adicional: admins pueden hacer UPDATE de cualquier match.
--    No usamos un `update only(min_shots)` porque PostgreSQL RLS no
--    soporta restringir por columna en una sola policy; un admin con
--    intención maliciosa puede editar cualquier campo del match igual
--    (ya tienen acceso a /admin). El check de "solo admin" se hace por
--    auth, no por columna.
create policy "matches_update_admin"
  on public.matches for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin = true
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin = true
    )
  );
