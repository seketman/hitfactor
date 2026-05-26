-- =====================================================================
-- HitFactor — Flag de "ausente" en match_entries
-- =====================================================================
-- Cuando un tirador se anota en un torneo pero no asiste, los archivos
-- de resultados lo dejan con place al final, 0 puntos y 0%. Hasta hoy
-- esa entry se importaba como una participación normal y bajaba el
-- promedio y la consistencia del tirador.
--
-- Esta columna distingue "no compitió" de "compitió y le fue mal". Igual
-- que is_dq, las stats la filtran de los agregados, pero a diferencia
-- de is_dq el badge en la UI es neutro (no señala una infracción).
--
-- Patrón calcado de is_dq: paralela, NOT NULL default false, sin index
-- (la cardinalidad de match_entries por match es chica y los filtros
-- se hacen junto a otros predicates con índice).
-- =====================================================================

alter table public.match_entries
  add column is_absent boolean not null default false;

comment on column public.match_entries.is_absent is
  'True si el tirador estaba anotado pero no se presentó (0 puntos, 0%). Excluido de las stats agregadas, igual que is_dq.';
