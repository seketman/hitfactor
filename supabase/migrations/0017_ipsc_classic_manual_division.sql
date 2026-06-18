-- =====================================================================
-- HitFactor — División Classic Manual para IPSC
-- =====================================================================
-- Los torneos de escopeta exportados desde la app PractiScore traen una
-- división "Classic Manual" (distinta de "Classic"). La columna `Div` de
-- esos resultados la abrevia como `CM`, y sin esta migración el nuevo
-- parser de PDFs de PractiScore (src/lib/parsers/practiscore-pdf.ts)
-- silenciosamente descarta esa sección porque el code no existe en
-- `divisions`.
--
-- "Standard Manual" (SM), Open (O) y Standard (S) ya existen desde la
-- migración inicial — solo falta Classic Manual.
--
-- La migración solo AGREGA la división nueva — no toca filas existentes
-- ni cambia el comportamiento de las otras divisiones.
-- =====================================================================

insert into public.divisions (discipline_id, code, name) values
  ((select id from public.disciplines where code = 'ipsc'), 'CM', 'Classic Manual');
