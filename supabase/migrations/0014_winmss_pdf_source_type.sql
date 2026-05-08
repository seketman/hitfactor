-- Permitir source_type = 'winmss_pdf' (PDFs históricos de ipsc.org.ar)
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
    'winmss_pdf',
    'fbi_csv',
    'manual'
  ));
