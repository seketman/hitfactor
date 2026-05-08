-- =====================================================================
-- HitFactor — división IPSC "Pistola" (genérica) para imports WinMSS
-- =====================================================================
-- Los archivos PDF de ipsc.org.ar (formato WinMSS) usados en eventos
-- sociales del TFABA agrupan a los tiradores de pistola en una sección
-- "PISTOLA" sin subdividirlos por Production/Open/Standard/etc.
--
-- Para representar fielmente esos resultados sin forzar una división que
-- no figura en el original, agregamos `PIS` (Pistola) como división de
-- IPSC. Las divisiones reales (O, P, PO, S, SM, CO, etc.) siguen
-- existiendo y se siguen usando para los archivos PractiScore HTML que
-- sí las distinguen.
--
-- Nota: el código `PIS` también existe en la disciplina Tiro FBI para su
-- propia "Pistola" — la unique constraint es (discipline_id, code), así
-- que no hay colisión.
-- =====================================================================

insert into public.divisions (discipline_id, code, name) values
  ((select id from public.disciplines where code = 'ipsc'), 'PIS', 'Pistola');
