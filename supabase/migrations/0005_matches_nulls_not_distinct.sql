-- =====================================================================
-- HitFactor — UNIQUE de matches resistente a NULL en region
-- =====================================================================
-- El UNIQUE original (discipline_id, name, date, region) no detecta como
-- duplicados los matches con region NULL, porque PostgreSQL trata NULL
-- como "distinto de cualquier valor, incluso otro NULL" en UNIQUE.
--
-- Esto se rompe con FBI (cuyas planillas no tienen una región global del
-- torneo): un mismo Social 4 podía importarse dos veces.
--
-- Pasamos a NULLS NOT DISTINCT (Postgres 15+) para que dos NULLs cuenten
-- como iguales.
-- =====================================================================

alter table public.matches
  drop constraint if exists matches_discipline_id_name_date_region_key;

alter table public.matches
  add constraint matches_unique_torneo
  unique nulls not distinct (discipline_id, name, date, region);
