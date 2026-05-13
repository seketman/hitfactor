-- =====================================================================
-- HitFactor — seed completo de clubes federados IPSC Argentina (FATP)
-- =====================================================================
-- Fuente: https://ipsc.org.ar/institucional/zonas/ (Federación Argentina
-- de Tiro Práctico, región IPSC AR).
--
-- Esta migración:
--  1. Borra el club "TFBA" (huérfano, no figura en el listado FATP). Antes
--     de borrarlo verifica que no esté referenciado por ningún match — si
--     lo está, aborta para que el operador migre primero esos matches.
--  2. Sobrescribe los nombres de TFABA y ATyGQ con los nombres oficiales
--     del listado FATP (los que estaban en DB tenían diferencias menores).
--  3. Inserta 36 clubes nuevos agrupados por zona (Atlántica, Centro,
--     Cuyo, Litoral, Metropolitana, Noreste, Noroeste, Patagónica).
--     Usa ON CONFLICT (code) DO NOTHING para ser idempotente.
--
-- Decisiones sobre codes problemáticos:
--  - "APT MEND" (Andino Polígono de Tiro) tenía un espacio en el medio
--    en la fuente — lo normalizamos a "APTMEND" para evitar problemas de
--    slug/URL.
--  - "TFAPa" (Paraná) y "TFAPe" (Pergamino) se diferencian solo por la
--    última letra en mayúscula/minúscula. Lo dejamos así porque es la
--    convención oficial de FATP — la columna `code` es case-sensitive y
--    no chocan, pero hay que tener cuidado al tipear.
--
-- Se omiten dos entradas del listado de FATP que no son clubes reales:
--  - "DELEGACION INTERNACIONAL" (code "Ext")
--  - "FTPRA" (entidad federativa, no club)
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Paso 1: borrar TFBA (con safety check)
-- ---------------------------------------------------------------------
-- Si algún match.region referencia 'TFBA' o 'ARG-TFBA', abortamos antes
-- de borrar el catálogo — esos matches quedarían con texto huérfano en
-- el dropdown. En ese caso, primero editá esos matches desde la UI o
-- corré un UPDATE manual para reasignar la region, y después re-aplicá
-- esta migration.
do $$
declare
  ref_count integer;
begin
  select count(*) into ref_count
  from public.matches
  where region in ('TFBA', 'ARG-TFBA');

  if ref_count > 0 then
    raise exception
      'No se puede borrar TFBA: % match(es) lo referencian en matches.region. Actualizá esos matches primero y volvé a correr la migration.',
      ref_count;
  end if;
end $$;

delete from public.clubs where code = 'TFBA';

-- ---------------------------------------------------------------------
-- Paso 2: actualizar nombres a los oficiales de FATP
-- ---------------------------------------------------------------------
update public.clubs
   set name = 'Tiro Federal Argentino de Buenos Aires'
 where code = 'TFABA';

update public.clubs
   set name = 'Asociacion de Tiro y Gimnasia de Quilmes'
 where code = 'ATyGQ';

-- ---------------------------------------------------------------------
-- Paso 3: insertar clubes nuevos (agrupados por zona FATP)
-- ---------------------------------------------------------------------

-- Zona Atlántica
insert into public.clubs (code, name, country) values
  ('TFAMDP', 'Tiro Federal Arg. de Mar del Plata',  'ARG'),
  ('TFAN',   'Tiro Federal Argentino de Necochea',  'ARG'),
  ('TFBB',   'Tiro Federal Bahia Blanca',           'ARG')
on conflict (code) do nothing;

-- Zona Centro
insert into public.clubs (code, name, country) values
  ('TFAGC',  'Club Náutico de Cazadores Pescadores y Tiro de Alta Gracia', 'ARG'),
  ('TFALB',  'Tiro Federal Argentino de La Banda',  'ARG'),
  ('TFAR3',  'Tiro Federal Argentino Rio Tercero',  'ARG'),
  ('TFC',    'Tiro Federal Cordoba',                'ARG'),
  ('TFVM',   'Tiro Federal de Villa María',         'ARG'),
  ('TFRC',   'Tiro Federal Río Cuarto',             'ARG'),
  ('TSVGB',  'Tiro Suizo Villa General Belgrano',   'ARG'),
  ('TGSF',   'Tiro Y Gimnasia San Francisco',       'ARG')
on conflict (code) do nothing;

-- Zona Cuyo
-- Nota: "APT MEND" del source FATP se normaliza a "APTMEND" (sin espacio).
insert into public.clubs (code, name, country) values
  ('APTMEND', 'Andino Polígono de Tiro',            'ARG'),
  ('TFASJ',   'Tiro Federal Argentino de San Juan', 'ARG')
on conflict (code) do nothing;

-- Zona Litoral
-- Nota: TFAPa (Paraná) y TFAPe (Pergamino) difieren solo en mayúscula/minúscula.
insert into public.clubs (code, name, country) values
  ('TSR',   'Sociedad Tiro Suizo de Rosario',         'ARG'),
  ('TFAE',  'Tiro Federal Argentino de Esperanza',    'ARG'),
  ('TFAPe', 'Tiro Federal Argentino de Pergamino',    'ARG'),
  ('TFAR',  'Tiro Federal Argentino de Rafaela',      'ARG'),
  ('TFASF', 'Tiro Federal Argentino de Santa Fe',     'ARG'),
  ('TFAPa', 'Tiro Federal Argentino Paraná',          'ARG'),
  ('TFASN', 'Tiro Federal Argentino San Nicolás',     'ARG'),
  ('TFR',   'Tiro Federal de Rosario',                'ARG')
on conflict (code) do nothing;

-- Zona Metropolitana (TFALP, TFLZ, TFABA y ATyGQ ya estaban del seed inicial)
insert into public.clubs (code, name, country) values
  ('CCO',  'Centro de Cazadores del Oeste',         'ARG'),
  ('TFAC', 'Tiro Federal Argentino de Campana',     'ARG'),
  ('TFAL', 'Tiro Federal Argentino de Lujan',       'ARG')
on conflict (code) do nothing;

-- Zona Noreste
insert into public.clubs (code, name, country) values
  ('G2',   'Polígono G2',                       'ARG'),
  ('TFAG', 'Tiro Federal Argentino de Goya',    'ARG'),
  ('TFF',  'Tiro Federal Formosa',              'ARG'),
  ('ATFM', 'Tiro Federal Misiones',             'ARG')
on conflict (code) do nothing;

-- Zona Noroeste
insert into public.clubs (code, name, country) values
  ('TFS', 'Tiro Federal de Salta',    'ARG'),
  ('TFT', 'Tiro Federal de Tucumán',  'ARG')
on conflict (code) do nothing;

-- Zona Patagónica
insert into public.clubs (code, name, country) values
  ('TF2AH', 'Asociacion Civil Tiro Federal 2 De Abril Ushuaia', 'ARG'),
  ('CCMGL', 'Circulo de Caza Mayor General Lagos',              'ARG'),
  ('PCC',   'Poligono Ciudad de Centenario',                    'ARG'),
  ('TFAPM', 'Tiro Federal Argentino De Puerto Madryn Gral.',    'ARG'),
  ('TFBar', 'Tiro Federal Bariloche',                           'ARG'),
  ('TFVR',  'Tiro Federal Villa Regina',                        'ARG')
on conflict (code) do nothing;

commit;
