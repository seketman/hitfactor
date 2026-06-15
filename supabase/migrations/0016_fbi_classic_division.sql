-- =====================================================================
-- HitFactor — División Classic para Tiro FBI
-- =====================================================================
-- TFALP corre torneos de Tiro FBI con una división "Classic" además de
-- Pistola, Revólver, Minirifle y PCC. La columna `Disciplina` del CSV
-- viene con valor "Classic" para esos tiradores, y sin esta migración
-- el parser silenciosamente saltea esas filas porque el código no existe
-- en `divisions`.
--
-- La migración solo AGREGA la división nueva — no toca filas existentes
-- ni cambia el comportamiento de las otras divisiones.
-- =====================================================================

insert into public.divisions (discipline_id, code, name) values
  ((select id from public.disciplines where code = 'tiro_fbi'), 'CLASSIC', 'Classic');
