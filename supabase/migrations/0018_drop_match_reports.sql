-- Drop de tabla `match_reports`.
--
-- Diseñada en el schema inicial (0001) para que usuarios reporten
-- inconsistencias en un match. Nunca se llegó a implementar el feature: la
-- tabla quedó vacía y sin código que la lea ni la escriba. Para reportes
-- de bugs/sugerencias usamos la tabla `feedback` (0011).
--
-- `drop table` también elimina sus policies de RLS y el índice
-- match_reports_match_idx automáticamente. La FK a matches/auth.users es
-- ON DELETE CASCADE así que no bloquea futuros deletes.

drop table if exists public.match_reports;
