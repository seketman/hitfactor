-- Columna `hits` para registrar impactos (tiros acertados) en disciplinas
-- donde el criterio de ranking primario es la cantidad de impactos, no el
-- puntaje total. Caso de uso principal: Tiro FBI (40 disparos máx, ranking
-- por impactos > puntos).
--
-- Es nullable porque IPSC y Steel Challenge no usan este concepto.

alter table public.match_entries
  add column hits smallint;

alter table public.stage_results
  add column hits smallint;
