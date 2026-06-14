-- =====================================================================
-- HitFactor — Soporte para importar reportes PDF de Steel Challenge
-- =====================================================================
-- PractiScore iPhone exporta los resultados de Steel Challenge como PDFs
-- "Stage Results - By Division" (uno por stage) en lugar del HTML clásico.
-- El parser nuevo (src/lib/parsers/steel-challenge-pdf.ts) persiste esos
-- matches con source_type = 'practiscore_steel_pdf'.
--
-- Misma forma que 0004_fat_pdf_source.sql: ampliamos el CHECK constraint
-- sin tocar filas existentes ni cambiar el comportamiento de los otros
-- formatos.
-- =====================================================================

alter table public.matches
  drop constraint if exists matches_source_type_check;

alter table public.matches
  add constraint matches_source_type_check check (source_type in (
    'practiscore_match_html',
    'practiscore_combined_html',
    'practiscore_stage_html',
    'practiscore_steel_html',
    'practiscore_steel_pdf',
    'practiscore_pdf',
    'winmss_pdf',
    'fbi_csv',
    'fat_pdf',
    'manual'
  ));
