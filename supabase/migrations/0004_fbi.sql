-- =====================================================================
-- HitFactor — soporte de Tiro FBI
-- =====================================================================
-- - Agrega las 4 divisiones de FBI (Pistola, Revólver, Minirifle, PCC).
-- - Habilita el nuevo source_type 'fbi_csv' en el CHECK de matches.
--
-- La disciplina 'tiro_fbi' ya viene seedeada en 0001 con scoring_type 'points'.
-- =====================================================================

-- 1) Divisiones de FBI
insert into public.divisions (discipline_id, code, name) values
  ((select id from public.disciplines where code = 'tiro_fbi'), 'PIS',  'Pistola'),
  ((select id from public.disciplines where code = 'tiro_fbi'), 'REV',  'Revólver'),
  ((select id from public.disciplines where code = 'tiro_fbi'), 'MINI', 'Minirifle'),
  ((select id from public.disciplines where code = 'tiro_fbi'), 'PCC',  'Pistol Caliber Carbine')
on conflict (discipline_id, code) do nothing;

-- 2) Aceptar el nuevo source_type en matches
alter table public.matches
  drop constraint if exists matches_source_type_check;

alter table public.matches
  add constraint matches_source_type_check
  check (source_type in (
    'practiscore_match_html',
    'practiscore_combined_html',
    'practiscore_stage_html',
    'practiscore_steel_html',
    'practiscore_pdf',
    'fbi_csv',
    'manual'
  ));
