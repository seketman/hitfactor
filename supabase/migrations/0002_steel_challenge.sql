-- =====================================================================
-- HitFactor — soporte para Steel Challenge
-- =====================================================================
-- Cambios:
--   1. Agrega columna total_time_seconds a match_entries para
--      disciplinas time-based (Steel, Combat).
--   2. Pre-carga las divisiones más comunes de Steel Challenge.
-- =====================================================================

-- 1) total_time_seconds en match_entries (NULL para disciplinas hit-factor)
alter table public.match_entries
  add column if not exists total_time_seconds numeric(8,3);

comment on column public.match_entries.total_time_seconds is
  'Tiempo total del match en segundos (Steel Challenge, Combat). NULL para IPSC.';

-- 2) Divisiones de Steel Challenge
insert into public.divisions (discipline_id, code, name) values
  ((select id from public.disciplines where code = 'steel_challenge'), 'PISTOLA',  'Pistola'),
  ((select id from public.disciplines where code = 'steel_challenge'), 'REVOLVER', 'Revolver'),
  ((select id from public.disciplines where code = 'steel_challenge'), 'OPEN',     'Open'),
  ((select id from public.disciplines where code = 'steel_challenge'), 'ROOKIE',   'Rookie'),
  ((select id from public.disciplines where code = 'steel_challenge'), 'IRON',     'Iron Sight'),
  ((select id from public.disciplines where code = 'steel_challenge'), 'OPTIC',    'Optic Sight'),
  ((select id from public.disciplines where code = 'steel_challenge'), 'PCC',      'Pistol Caliber Carbine')
on conflict (discipline_id, code) do nothing;
