-- =====================================================================
-- HitFactor — seed completo de clubes federados IPSC Argentina (FATP)
-- =====================================================================
-- Fuente: https://ipsc.org.ar/institucional/zonas/ (Federación Argentina
-- de Tiro Práctico, región IPSC AR).
--
-- Esta migración:
--  1. Agrega la columna `zone` a `clubs` para registrar la zona geográfica
--     FATP de cada club. Habilita en el futuro KPIs/agregaciones por zona.
--     Se deja nullable: eventuales clubes extranjeros u otros que no
--     pertenezcan al esquema FATP pueden quedar sin zona.
--  2. Backfillea con zona = 'Metropolitana' a los 4 clubes pre-existentes
--     (todos pertenecen a esa zona según FATP). TFBA se elimina así que
--     no se le asigna zona.
--  3. Borra el club "TFBA" (huérfano, no figura en el listado FATP). Antes
--     de borrarlo verifica que no esté referenciado por ningún match — si
--     lo está, aborta para que el operador migre primero esos matches.
--  4. Sobrescribe los nombres de TFABA y ATyGQ con los nombres oficiales
--     del listado FATP (los que estaban en DB tenían diferencias menores).
--  5. Inserta 36 clubes nuevos agrupados por zona (Atlántica, Centro,
--     Cuyo, Litoral, Metropolitana, Noreste, Noroeste, Patagónica).
--     Cada inserción ya trae su zona poblada. Usa ON CONFLICT (code) DO
--     NOTHING para ser idempotente.
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
-- Paso 1: agregar columna `zone` y backfillear pre-existentes
-- ---------------------------------------------------------------------
alter table public.clubs add column if not exists zone text;

comment on column public.clubs.zone is
  'Zona geográfica FATP (Atlántica, Centro, Cuyo, Litoral, Metropolitana, Noreste, Noroeste, Patagónica). Nullable porque eventualmente puede haber clubes fuera del esquema FATP.';

-- Backfill: TFALP, TFLZ, TFABA y ATyGQ son todos Metropolitana según FATP.
-- TFBA se elimina abajo así que no le asignamos zona.
update public.clubs
   set zone = 'Metropolitana'
 where code in ('TFALP', 'TFLZ', 'TFABA', 'ATyGQ');

-- ---------------------------------------------------------------------
-- Paso 2: borrar TFBA (con safety check)
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
-- Paso 3: actualizar nombres a los oficiales de FATP
-- ---------------------------------------------------------------------
update public.clubs
   set name = 'Tiro Federal Argentino de Buenos Aires'
 where code = 'TFABA';

update public.clubs
   set name = 'Asociacion de Tiro y Gimnasia de Quilmes'
 where code = 'ATyGQ';

-- ---------------------------------------------------------------------
-- Paso 4: insertar clubes nuevos (agrupados por zona FATP)
-- ---------------------------------------------------------------------

-- Zona Atlántica
insert into public.clubs (code, name, country, zone) values
  ('TFAMDP', 'Tiro Federal Arg. de Mar del Plata',  'ARG', 'Atlántica'),
  ('TFAN',   'Tiro Federal Argentino de Necochea',  'ARG', 'Atlántica'),
  ('TFBB',   'Tiro Federal Bahia Blanca',           'ARG', 'Atlántica')
on conflict (code) do nothing;

-- Zona Centro
insert into public.clubs (code, name, country, zone) values
  ('TFAGC',  'Club Náutico de Cazadores Pescadores y Tiro de Alta Gracia', 'ARG', 'Centro'),
  ('TFALB',  'Tiro Federal Argentino de La Banda',  'ARG', 'Centro'),
  ('TFAR3',  'Tiro Federal Argentino Rio Tercero',  'ARG', 'Centro'),
  ('TFC',    'Tiro Federal Cordoba',                'ARG', 'Centro'),
  ('TFVM',   'Tiro Federal de Villa María',         'ARG', 'Centro'),
  ('TFRC',   'Tiro Federal Río Cuarto',             'ARG', 'Centro'),
  ('TSVGB',  'Tiro Suizo Villa General Belgrano',   'ARG', 'Centro'),
  ('TGSF',   'Tiro Y Gimnasia San Francisco',       'ARG', 'Centro')
on conflict (code) do nothing;

-- Zona Cuyo
-- Nota: "APT MEND" del source FATP se normaliza a "APTMEND" (sin espacio).
insert into public.clubs (code, name, country, zone) values
  ('APTMEND', 'Andino Polígono de Tiro',            'ARG', 'Cuyo'),
  ('TFASJ',   'Tiro Federal Argentino de San Juan', 'ARG', 'Cuyo')
on conflict (code) do nothing;

-- Zona Litoral
-- Nota: TFAPa (Paraná) y TFAPe (Pergamino) difieren solo en mayúscula/minúscula.
insert into public.clubs (code, name, country, zone) values
  ('TSR',   'Sociedad Tiro Suizo de Rosario',         'ARG', 'Litoral'),
  ('TFAE',  'Tiro Federal Argentino de Esperanza',    'ARG', 'Litoral'),
  ('TFAPe', 'Tiro Federal Argentino de Pergamino',    'ARG', 'Litoral'),
  ('TFAR',  'Tiro Federal Argentino de Rafaela',      'ARG', 'Litoral'),
  ('TFASF', 'Tiro Federal Argentino de Santa Fe',     'ARG', 'Litoral'),
  ('TFAPa', 'Tiro Federal Argentino Paraná',          'ARG', 'Litoral'),
  ('TFASN', 'Tiro Federal Argentino San Nicolás',     'ARG', 'Litoral'),
  ('TFR',   'Tiro Federal de Rosario',                'ARG', 'Litoral')
on conflict (code) do nothing;

-- Zona Metropolitana (TFALP, TFLZ, TFABA y ATyGQ ya estaban del seed inicial)
insert into public.clubs (code, name, country, zone) values
  ('CCO',  'Centro de Cazadores del Oeste',         'ARG', 'Metropolitana'),
  ('TFAC', 'Tiro Federal Argentino de Campana',     'ARG', 'Metropolitana'),
  ('TFAL', 'Tiro Federal Argentino de Lujan',       'ARG', 'Metropolitana')
on conflict (code) do nothing;

-- Zona Noreste
insert into public.clubs (code, name, country, zone) values
  ('G2',   'Polígono G2',                       'ARG', 'Noreste'),
  ('TFAG', 'Tiro Federal Argentino de Goya',    'ARG', 'Noreste'),
  ('TFF',  'Tiro Federal Formosa',              'ARG', 'Noreste'),
  ('ATFM', 'Tiro Federal Misiones',             'ARG', 'Noreste')
on conflict (code) do nothing;

-- Zona Noroeste
insert into public.clubs (code, name, country, zone) values
  ('TFS', 'Tiro Federal de Salta',    'ARG', 'Noroeste'),
  ('TFT', 'Tiro Federal de Tucumán',  'ARG', 'Noroeste')
on conflict (code) do nothing;

-- Zona Patagónica
insert into public.clubs (code, name, country, zone) values
  ('TF2AH', 'Asociacion Civil Tiro Federal 2 De Abril Ushuaia', 'ARG', 'Patagónica'),
  ('CCMGL', 'Circulo de Caza Mayor General Lagos',              'ARG', 'Patagónica'),
  ('PCC',   'Poligono Ciudad de Centenario',                    'ARG', 'Patagónica'),
  ('TFAPM', 'Tiro Federal Argentino De Puerto Madryn Gral.',    'ARG', 'Patagónica'),
  ('TFBar', 'Tiro Federal Bariloche',                           'ARG', 'Patagónica'),
  ('TFVR',  'Tiro Federal Villa Regina',                        'ARG', 'Patagónica')
on conflict (code) do nothing;

commit;
