-- =====================================================================
-- HitFactor — Soporte para importar rankings PDF de la FAT
-- =====================================================================
-- La FAT (Federación Argentina de Tiro) publica un PDF de "RANKING OFICIAL"
-- con los resultados generales del match (sin stages). El parser nuevo
-- (src/lib/parsers/fat-pdf.ts) persiste esos matches con
-- source_type = 'fat_pdf'.
--
-- El CHECK constraint matches_source_type_check de 0001 enumera los
-- source_type válidos; sin esta migración el INSERT del import falla.
-- Esta migración solo AMPLÍA el conjunto de valores aceptados: no toca
-- filas existentes ni cambia el comportamiento de los otros formatos.
-- =====================================================================

alter table public.matches
  drop constraint if exists matches_source_type_check;

alter table public.matches
  add constraint matches_source_type_check check (source_type in (
    'practiscore_match_html',
    'practiscore_combined_html',
    'practiscore_stage_html',
    'practiscore_steel_html',
    'practiscore_pdf',
    'winmss_pdf',
    'fbi_csv',
    'fat_pdf',
    'manual'
  ));
