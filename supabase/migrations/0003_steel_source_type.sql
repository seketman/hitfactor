-- =====================================================================
-- HitFactor — actualiza el CHECK de matches.source_type
-- =====================================================================
-- Motivo: la migración 0001 enumeraba solo los source_type de IPSC.
-- Con la disciplina Steel Challenge agregamos 'practiscore_steel_html'.
-- =====================================================================

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
    'manual'
  ));
