-- =====================================================================
-- HitFactor — Backfill de is_absent en matches importados pre-0007
-- =====================================================================
-- Los matches importados antes de la migración 0007 fueron procesados con
-- parsers que no conocían el concepto de "ausente": un tirador anotado que
-- no asistió quedaba con 0 puntos y 0% pero is_absent=false (default).
--
-- Replicamos acá la lógica de detección de cada parser (ver
-- `src/lib/parsers/*.ts`) para que no haga falta re-importar nada. Cada
-- bloque está scoped por `source_type` para no aplicar la regla de un
-- parser a datos de otro (las reglas son sutilmente distintas: Steel usa
-- ausencia-de-tiempo, FBI exige hits=0, etc.).
--
-- Idempotente: re-correrlo no afecta filas que ya quedaron correctas.
-- =====================================================================

-- PractiScore IPSC y FAT PDF
-- Regla: matchPoints = 0 AND matchPercentage = 0 (con is_dq = false).
update public.match_entries me
   set is_absent = true
  from public.matches m
 where me.match_id = m.id
   and me.is_dq = false
   and me.is_absent = false
   and me.match_points = 0
   and me.match_percentage = 0
   and m.source_type in (
     'practiscore_match_html',
     'practiscore_combined_html',
     'practiscore_stage_html',
     'practiscore_pdf',
     'fat_pdf'
   );

-- Steel Challenge
-- Regla: totalTime IS NULL AND matchPercentage = 0. No miramos match_points
-- porque el parser de Steel lo hardcodea a 0 para todas las entries (el
-- ranking es por tiempo).
update public.match_entries me
   set is_absent = true
  from public.matches m
 where me.match_id = m.id
   and me.is_dq = false
   and me.is_absent = false
   and me.total_time_seconds is null
   and me.match_percentage = 0
   and m.source_type = 'practiscore_steel_html';

-- FBI CSV
-- Regla: hits = 0 AND matchPoints = 0 AND matchPercentage = 0. La FBI
-- rankea por impactos antes que por puntos; un ausente cumple las tres.
update public.match_entries me
   set is_absent = true
  from public.matches m
 where me.match_id = m.id
   and me.is_dq = false
   and me.is_absent = false
   and me.hits = 0
   and me.match_points = 0
   and me.match_percentage = 0
   and m.source_type = 'fbi_csv';

-- WinMSS PDF — caso especial
-- El parser viejo marcaba is_dq=true para CUALQUIER entry con matchPoints=0,
-- mezclando ausentes con DQs reales. Los DQ legítimos (`parseDqPageRows` y
-- la rama `DQ_ROW_RE`) tienen `place = 0` porque no se conoce el puesto.
-- Los ausentes tienen `place > 0` (el reporte los lista al final con un
-- número de puesto real). Usamos esa señal para flipear solo los falsos DQ.
update public.match_entries me
   set is_dq = false,
       is_absent = true
  from public.matches m
 where me.match_id = m.id
   and me.is_dq = true
   and me.match_points = 0
   and me.place > 0
   and m.source_type = 'winmss_pdf';
