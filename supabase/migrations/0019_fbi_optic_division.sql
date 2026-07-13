-- =====================================================================
-- HitFactor — División Optic para Tiro FBI
-- =====================================================================
-- TFALP corre torneos de Tiro FBI con una división "Optic" (pistola con
-- óptica) además de Pistola, Revólver, Minirifle, PCC y Classic. La columna
-- `Disciplina` del CSV viene con valor "Optic" para esos tiradores y, sin
-- esta migración, el parser descartaba esas filas en silencio porque el code
-- no existe en `divisions`.
--
-- No choca con el `OPTIC` de Steel Challenge: la unique es
-- (discipline_id, code).
--
-- La migración solo AGREGA la división nueva — no toca filas existentes ni
-- cambia el comportamiento de las otras divisiones.
-- =====================================================================

insert into public.divisions (discipline_id, code, name) values
  ((select id from public.disciplines where code = 'tiro_fbi'), 'OPTIC', 'Optic');
