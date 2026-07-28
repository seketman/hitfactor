-- =====================================================================
-- HitFactor — esquema consolidado
-- =====================================================================
-- Este archivo es el resultado de aplastar (squash) las 20 migraciones
-- incrementales que existían hasta el PR #15 (mayo 2026) en un único
-- script de bootstrap. Representa el estado del esquema en ese momento, no
-- la historia de cómo se llegó a él.
--
-- OJO, ESTO NO ALCANZA PARA LEVANTAR LA DB. Después del squash la
-- numeración arrancó de nuevo, así que los archivos 0002+ de esta misma
-- carpeta son POSTERIORES a este y NO están incluidos acá. Sin ellos te
-- faltan, entre otras cosas, `is_absent`, `min_shots`, `qr_code`,
-- `is_admin`, las tablas de municiones y de uso de armas, y el bucket de
-- Storage para los imports.
--
-- Para levantar una base de cero: correr este archivo y después TODOS los
-- 0002+ en orden numérico. La lista completa está en `docs/development.md`.
--
-- Por qué consolidar: para poder recrear la DB de cero en otra plataforma
-- con un solo script, en vez de reproducir 20 migraciones parciales con
-- sus idas y vueltas (tablas que se crean y después se dropean, CHECKs que
-- se reescriben varias veces, seeds que se editan, etc.).
--
-- Objetos que define:
--   Funciones:  set_updated_at, handle_new_user, feedback_set_updated_at,
--               merge_duplicate_shooters
--   Tablas:     profiles, disciplines, divisions, shooters, matches,
--               stages, match_entries, stage_results, firearms,
--               match_firearm_log, clubs, audit_log, feedback
--   Lookups seedeados: disciplines, divisions, clubs
--   + índices, triggers y políticas RLS de todas las tablas.
--
-- Partes específicas de Supabase (revisar al migrar de plataforma):
--   - Referencias a `auth.users` (FKs y el trigger on_auth_user_created).
--   - `auth.uid()` / `auth.role()` en las políticas RLS.
--   - El rol `authenticated`.
-- En otro Postgres sin Supabase Auth habría que reemplazar esos puntos por
-- el mecanismo de identidad equivalente.
-- =====================================================================

begin;

-- =====================================================================
-- HELPERS
-- =====================================================================

-- Trigger genérico: mantiene `updated_at` en sync en cada UPDATE.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- =====================================================================
-- profiles
-- =====================================================================
-- Extiende auth.users con info de perfil del usuario logueado.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  full_name    text,
  member_number text,
  default_region text,
  -- Preferencias de UI persistidas server-side para que sigan al usuario
  -- entre dispositivos. JSON libre — la forma se valida en el cliente.
  -- Hoy: { "matchesPageSize": 10|20|50|100 }.
  ui_prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.profiles.ui_prefs is
  'Preferencias de UI por usuario, persistidas server-side para que sigan al user entre dispositivos. JSON libre — la forma se valida en el cliente.';

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Crea el profile automáticamente cuando se registra un usuario.
-- Cadena de fallback para soportar tanto signup email/password como
-- Google OAuth (que manda los campos como `name` / `full_name`, nunca
-- `display_name`):
--   display_name: 'display_name' → 'full_name' → 'name' → email-prefix
--   full_name:    'full_name' → 'name'
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, full_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name'
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();


-- =====================================================================
-- disciplines (lookup)
-- =====================================================================
create table public.disciplines (
  id smallserial primary key,
  code text not null unique,
  name text not null,
  scoring_type text not null
);

insert into public.disciplines (code, name, scoring_type) values
  ('ipsc',             'Tiro Práctico',     'hit_factor'),
  ('steel_challenge',  'Steel Challenge',   'time_plus'),
  ('combat_solutions', 'Combat Solutions',  'time_plus'),
  ('tiro_fbi',         'Tiro FBI',          'points');


-- =====================================================================
-- divisions (lookup, por disciplina)
-- =====================================================================
create table public.divisions (
  id smallserial primary key,
  discipline_id smallint not null references public.disciplines(id) on delete cascade,
  code text not null,
  name text not null,
  unique (discipline_id, code)
);

-- IPSC. `PIS` (Pistola genérica) cubre los PDF WinMSS de ipsc.org.ar que
-- agrupan a los tiradores de pistola sin subdividir por división real.
insert into public.divisions (discipline_id, code, name) values
  ((select id from public.disciplines where code = 'ipsc'), 'O',    'Open'),
  ((select id from public.disciplines where code = 'ipsc'), 'P',    'Production'),
  ((select id from public.disciplines where code = 'ipsc'), 'PO',   'Production Optics'),
  ((select id from public.disciplines where code = 'ipsc'), 'PCC',  'Pistol Caliber Carbine'),
  ((select id from public.disciplines where code = 'ipsc'), 'PCCO', 'Pistol Caliber Carbine Optics'),
  ((select id from public.disciplines where code = 'ipsc'), 'S',    'Standard'),
  ((select id from public.disciplines where code = 'ipsc'), 'SM',   'Standard Manual'),
  ((select id from public.disciplines where code = 'ipsc'), 'CO',   'Carry Optics'),
  ((select id from public.disciplines where code = 'ipsc'), 'R',    'Revolver'),
  ((select id from public.disciplines where code = 'ipsc'), 'CL',   'Classic'),
  ((select id from public.disciplines where code = 'ipsc'), 'MS',   'Modified Shotgun'),
  ((select id from public.disciplines where code = 'ipsc'), 'PIS',  'Pistola');

-- Steel Challenge.
insert into public.divisions (discipline_id, code, name) values
  ((select id from public.disciplines where code = 'steel_challenge'), 'PISTOLA',  'Pistola'),
  ((select id from public.disciplines where code = 'steel_challenge'), 'REVOLVER', 'Revolver'),
  ((select id from public.disciplines where code = 'steel_challenge'), 'OPEN',     'Open'),
  ((select id from public.disciplines where code = 'steel_challenge'), 'ROOKIE',   'Rookie'),
  ((select id from public.disciplines where code = 'steel_challenge'), 'IRON',     'Iron Sight'),
  ((select id from public.disciplines where code = 'steel_challenge'), 'OPTIC',    'Optic Sight'),
  ((select id from public.disciplines where code = 'steel_challenge'), 'PCC',      'Pistol Caliber Carbine');

-- Tiro FBI. `PIS` también existe en IPSC — no choca porque la unique es
-- (discipline_id, code).
insert into public.divisions (discipline_id, code, name) values
  ((select id from public.disciplines where code = 'tiro_fbi'), 'PIS',  'Pistola'),
  ((select id from public.disciplines where code = 'tiro_fbi'), 'REV',  'Revólver'),
  ((select id from public.disciplines where code = 'tiro_fbi'), 'MINI', 'Minirifle'),
  ((select id from public.disciplines where code = 'tiro_fbi'), 'PCC',  'Pistol Caliber Carbine');


-- =====================================================================
-- shooters
-- =====================================================================
-- Tiradores que aparecen en resultados. Pueden estar linkeados a un user
-- (si el tirador es un usuario registrado) o ser huérfanos.
create table public.shooters (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  member_number text,
  region text,
  linked_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index shooters_full_name_idx on public.shooters using gin (to_tsvector('simple', full_name));
create index shooters_member_number_idx on public.shooters (member_number);
create index shooters_linked_user_idx on public.shooters (linked_user_id);

create trigger shooters_set_updated_at
before update on public.shooters
for each row execute function public.set_updated_at();


-- =====================================================================
-- matches
-- =====================================================================
-- Torneos. Los datos son públicos (cualquier usuario auth puede leer).
-- Solo el importador puede editar/borrar. No hay edit de datos (delete +
-- reimport); el UPDATE habilitado es para metadata como la región/club.
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  discipline_id smallint not null references public.disciplines(id),
  name text not null,
  date date not null,
  region text,
  source_type text not null check (source_type in (
    'practiscore_match_html',
    'practiscore_combined_html',
    'practiscore_stage_html',
    'practiscore_steel_html',
    'practiscore_pdf',
    'winmss_pdf',
    'fbi_csv',
    'manual'
  )),
  source_filename text,
  imported_by_user_id uuid not null references auth.users(id) on delete restrict,
  imported_at timestamptz not null default now(),
  import_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Deduplicación: el mismo torneo no puede subirse dos veces. NULLS NOT
  -- DISTINCT para que dos matches con region NULL (caso FBI, cuyas
  -- planillas no traen región global) cuenten como duplicados.
  constraint matches_unique_torneo
    unique nulls not distinct (discipline_id, name, date, region)
);

create index matches_discipline_date_idx on public.matches (discipline_id, date desc);
create index matches_importer_idx on public.matches (imported_by_user_id);

create trigger matches_set_updated_at
before update on public.matches
for each row execute function public.set_updated_at();


-- =====================================================================
-- stages
-- =====================================================================
create table public.stages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  stage_number smallint,
  name text not null,
  max_points integer,
  created_at timestamptz not null default now(),
  unique (match_id, stage_number)
);

create index stages_match_idx on public.stages (match_id);


-- =====================================================================
-- match_entries
-- =====================================================================
-- Participación de un tirador en un match (resultado general del match).
create table public.match_entries (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  shooter_id uuid not null references public.shooters(id) on delete restrict,
  division_id smallint not null references public.divisions(id),
  classification text,
  power_factor text check (power_factor in ('Min','Maj') or power_factor is null),
  category text,
  place integer not null,
  match_points numeric(10,4) not null default 0,
  match_percentage numeric(7,4) not null default 0,
  -- Tiempo total del match en segundos (Steel Challenge, Combat). NULL en IPSC.
  total_time_seconds numeric(8,3),
  -- Impactos (tiros acertados). Criterio de ranking primario en Tiro FBI.
  -- NULL en IPSC/Steel, que no usan este concepto.
  hits smallint,
  is_dq boolean not null default false,
  created_at timestamptz not null default now(),
  -- Un tirador puede aparecer en una sola división por match.
  unique (match_id, shooter_id, division_id)
);

comment on column public.match_entries.total_time_seconds is
  'Tiempo total del match en segundos (Steel Challenge, Combat). NULL para IPSC.';

create index match_entries_match_idx on public.match_entries (match_id);
create index match_entries_shooter_idx on public.match_entries (shooter_id);


-- =====================================================================
-- stage_results
-- =====================================================================
-- Resultado de un tirador en un stage.
create table public.stage_results (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.stages(id) on delete cascade,
  match_entry_id uuid not null references public.match_entries(id) on delete cascade,
  points numeric(10,4),
  penalties numeric(10,4),
  time_seconds numeric(8,3),
  hit_factor numeric(8,4),
  stage_points numeric(10,4) not null default 0,
  stage_percentage numeric(7,4) not null default 0,
  place integer,
  -- Impactos del stage (Tiro FBI). NULL en IPSC/Steel.
  hits smallint,
  is_dq boolean not null default false,
  created_at timestamptz not null default now(),
  unique (stage_id, match_entry_id)
);

create index stage_results_stage_idx on public.stage_results (stage_id);
create index stage_results_match_entry_idx on public.stage_results (match_entry_id);


-- =====================================================================
-- firearms
-- =====================================================================
-- Catálogo de armas de cada usuario. Datos privados — RLS por owner.
create table public.firearms (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  brand text,
  model text,
  caliber text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index firearms_owner_idx on public.firearms (owner_user_id);

create trigger firearms_set_updated_at
before update on public.firearms
for each row execute function public.set_updated_at();


-- =====================================================================
-- match_firearm_log
-- =====================================================================
-- Qué arma usó el usuario en cada match_entry y cuántos tiros disparó.
-- Una sola arma por match_entry (PK simple). Si después se necesita
-- backup-gun/swap, evoluciona a PK compuesta.
create table public.match_firearm_log (
  match_entry_id uuid primary key references public.match_entries(id) on delete cascade,
  firearm_id uuid not null references public.firearms(id) on delete cascade,
  rounds_fired integer not null default 0 check (rounds_fired >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index match_firearm_log_firearm_idx on public.match_firearm_log (firearm_id);

create trigger match_firearm_log_set_updated_at
before update on public.match_firearm_log
for each row execute function public.set_updated_at();


-- =====================================================================
-- clubs
-- =====================================================================
-- Catálogo de clubs. Alimenta el dropdown de "Editar club" en la UI.
-- `matches.region` sigue siendo un text suelto (puede traer "ARG-TFALP",
-- "TFALP" o texto libre cuando el importador eligió "Otro…") — no imponemos
-- FK para no romper ese fallback de texto libre.
create table public.clubs (
  code text primary key,
  name text not null,
  country text,
  -- Zona geográfica FATP. Nullable porque eventualmente puede haber clubes
  -- fuera del esquema FATP (extranjeros, etc.).
  zone text,
  created_at timestamptz not null default now()
);

comment on column public.clubs.zone is
  'Zona geográfica FATP (Atlántica, Centro, Cuyo, Litoral, Metropolitana, Noreste, Noroeste, Patagónica). Nullable porque eventualmente puede haber clubes fuera del esquema FATP.';

-- Seed: catálogo de clubes federados IPSC Argentina (FATP).
-- Fuente: https://ipsc.org.ar/institucional/zonas/
-- Notas de codes: "APT MEND" del source se normaliza a "APTMEND" (sin
-- espacio); "TFAPa" (Paraná) y "TFAPe" (Pergamino) difieren solo en
-- mayúscula/minúscula — es la convención oficial de FATP, `code` es
-- case-sensitive así que no chocan.
insert into public.clubs (code, name, country, zone) values
  -- Zona Metropolitana
  ('TFALP', 'Tiro Federal Argentino de La Plata',          'ARG', 'Metropolitana'),
  ('TFLZ',  'Tiro Federal de Lomas de Zamora',             'ARG', 'Metropolitana'),
  ('TFABA', 'Tiro Federal Argentino de Buenos Aires',      'ARG', 'Metropolitana'),
  ('ATyGQ', 'Asociacion de Tiro y Gimnasia de Quilmes',    'ARG', 'Metropolitana'),
  ('CCO',   'Centro de Cazadores del Oeste',               'ARG', 'Metropolitana'),
  ('TFAC',  'Tiro Federal Argentino de Campana',           'ARG', 'Metropolitana'),
  ('TFAL',  'Tiro Federal Argentino de Lujan',             'ARG', 'Metropolitana'),
  -- Zona Atlántica
  ('TFAMDP', 'Tiro Federal Arg. de Mar del Plata',         'ARG', 'Atlántica'),
  ('TFAN',   'Tiro Federal Argentino de Necochea',         'ARG', 'Atlántica'),
  ('TFBB',   'Tiro Federal Bahia Blanca',                  'ARG', 'Atlántica'),
  -- Zona Centro
  ('TFAGC',  'Club Náutico de Cazadores Pescadores y Tiro de Alta Gracia', 'ARG', 'Centro'),
  ('TFALB',  'Tiro Federal Argentino de La Banda',         'ARG', 'Centro'),
  ('TFAR3',  'Tiro Federal Argentino Rio Tercero',         'ARG', 'Centro'),
  ('TFC',    'Tiro Federal Cordoba',                       'ARG', 'Centro'),
  ('TFVM',   'Tiro Federal de Villa María',                'ARG', 'Centro'),
  ('TFRC',   'Tiro Federal Río Cuarto',                    'ARG', 'Centro'),
  ('TSVGB',  'Tiro Suizo Villa General Belgrano',          'ARG', 'Centro'),
  ('TGSF',   'Tiro Y Gimnasia San Francisco',              'ARG', 'Centro'),
  -- Zona Cuyo
  ('APTMEND', 'Andino Polígono de Tiro',                   'ARG', 'Cuyo'),
  ('TFASJ',   'Tiro Federal Argentino de San Juan',        'ARG', 'Cuyo'),
  -- Zona Litoral
  ('TSR',   'Sociedad Tiro Suizo de Rosario',              'ARG', 'Litoral'),
  ('TFAE',  'Tiro Federal Argentino de Esperanza',         'ARG', 'Litoral'),
  ('TFAPe', 'Tiro Federal Argentino de Pergamino',         'ARG', 'Litoral'),
  ('TFAR',  'Tiro Federal Argentino de Rafaela',           'ARG', 'Litoral'),
  ('TFASF', 'Tiro Federal Argentino de Santa Fe',          'ARG', 'Litoral'),
  ('TFAPa', 'Tiro Federal Argentino Paraná',               'ARG', 'Litoral'),
  ('TFASN', 'Tiro Federal Argentino San Nicolás',          'ARG', 'Litoral'),
  ('TFR',   'Tiro Federal de Rosario',                     'ARG', 'Litoral'),
  -- Zona Noreste
  ('G2',   'Polígono G2',                                  'ARG', 'Noreste'),
  ('TFAG', 'Tiro Federal Argentino de Goya',               'ARG', 'Noreste'),
  ('TFF',  'Tiro Federal Formosa',                         'ARG', 'Noreste'),
  ('ATFM', 'Tiro Federal Misiones',                        'ARG', 'Noreste'),
  -- Zona Noroeste
  ('TFS', 'Tiro Federal de Salta',                         'ARG', 'Noroeste'),
  ('TFT', 'Tiro Federal de Tucumán',                       'ARG', 'Noroeste'),
  -- Zona Patagónica
  ('TF2AH', 'Asociacion Civil Tiro Federal 2 De Abril Ushuaia', 'ARG', 'Patagónica'),
  ('CCMGL', 'Circulo de Caza Mayor General Lagos',              'ARG', 'Patagónica'),
  ('PCC',   'Poligono Ciudad de Centenario',                    'ARG', 'Patagónica'),
  ('TFAPM', 'Tiro Federal Argentino De Puerto Madryn Gral.',    'ARG', 'Patagónica'),
  ('TFBar', 'Tiro Federal Bariloche',                           'ARG', 'Patagónica'),
  ('TFVR',  'Tiro Federal Villa Regina',                        'ARG', 'Patagónica');


-- =====================================================================
-- audit_log
-- =====================================================================
-- Log de auditoría de las mutaciones que el usuario hace sobre sus datos
-- (claim de shooters, asignación de armas, edición/borrado de matches,
-- etc.). Diseño polimórfico: una sola tabla cubre todas las acciones, la
-- forma de `metadata` cambia por acción. Convenio de `action`: "entidad.verbo"
-- (ej: "shooter.claim"). Valores canónicos en src/lib/audit/log-action.ts.
create table public.audit_log (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_user_recent_idx
  on public.audit_log (user_id, created_at desc);

create index audit_log_entity_idx
  on public.audit_log (entity_type, entity_id);


-- =====================================================================
-- feedback
-- =====================================================================
-- Reportes de bugs y sugerencias enviados desde la página /about. El admin
-- los lee/actualiza con SQL directo en Supabase (service_role bypassa RLS).
-- Los usuarios ven solo sus propios reportes con su estado.
create table public.feedback (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('bug', 'suggestion', 'other')),
  message text not null check (char_length(message) between 10 and 4000),
  page_url text,
  -- Status neutros: aplican a cualquier `type`. La UI rendea el label según
  -- (status, type) — ej: `done` muestra "Resuelto" para bug e "Implementada"
  -- para suggestion.
  status text not null default 'new'
    check (status in ('new', 'triaged', 'in_progress', 'done', 'wontdo', 'duplicate')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index feedback_user_recent_idx
  on public.feedback (user_id, created_at desc);

create index feedback_status_idx
  on public.feedback (status, created_at desc);

-- Trigger propio (no usa set_updated_at) por consistencia con la migración
-- original que lo introdujo; funcionalmente idéntico.
create or replace function public.feedback_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger feedback_updated_at_trg
  before update on public.feedback
  for each row execute function public.feedback_set_updated_at();


-- =====================================================================
-- merge_duplicate_shooters (utilidad de mantenimiento)
-- =====================================================================
-- NO es parte del bootstrap del esquema — es una herramienta de reparación
-- de datos. Mergea grupos de tiradores duplicados (mismo nombre normalizado
-- + member_number) a un shooter canónico:
--   - Canónico: prefiere uno con linked_user_id NOT NULL (preserva claims),
--     si no, el más antiguo.
--   - Ante un conflicto de match_entries para el mismo (match, división),
--     se queda con el row más rico (hits IS NOT NULL gana).
--   - stage_results y firearm logs cascadean con match_entries.
-- Idempotente: sin duplicados, no hace nada. Se incluye acá para que la DB
-- recreada quede funcionalmente igual a la original; en una DB fresca nunca
-- hay duplicados así que no hace falta ejecutarla.
create or replace function public.merge_duplicate_shooters()
returns table (canonical_id uuid, duplicate_id uuid, entries_repointed int, entries_deleted int)
language plpgsql
as $$
declare
  grp record;
  dup_id uuid;
  dup_entry record;
  canon_entry_id uuid;
  canon_entry_hits smallint;
  repointed int;
  deleted int;
begin
  for grp in
    with ranked as (
      select
        id,
        lower(btrim(full_name)) as norm_name,
        member_number,
        row_number() over (
          partition by lower(btrim(full_name)), member_number
          order by (linked_user_id is not null) desc, created_at asc
        ) as rn
      from public.shooters
    )
    select
      norm_name,
      member_number,
      (select id from ranked r2 where r2.norm_name = r1.norm_name
        and (r2.member_number is not distinct from r1.member_number)
        and r2.rn = 1) as canon_id,
      array_agg(id) filter (where rn > 1) as dup_ids
    from ranked r1
    group by norm_name, member_number
    having count(*) > 1
  loop
    foreach dup_id in array grp.dup_ids loop
      repointed := 0;
      deleted := 0;

      for dup_entry in
        select id, match_id, division_id, hits
        from public.match_entries
        where shooter_id = dup_id
      loop
        select id, hits into canon_entry_id, canon_entry_hits
        from public.match_entries
        where shooter_id = grp.canon_id
          and match_id = dup_entry.match_id
          and division_id = dup_entry.division_id;

        if canon_entry_id is null then
          -- Sin conflicto: repuntamos el entry del duplicado al canónico.
          update public.match_entries
            set shooter_id = grp.canon_id
            where id = dup_entry.id;
          repointed := repointed + 1;
        else
          -- Conflicto: hay un row del canónico y un row del duplicado para
          -- el mismo (match, division). Nos quedamos con el más rico:
          -- preferimos el row que tenga hits != null.
          if dup_entry.hits is not null and canon_entry_hits is null then
            -- El duplicado tiene más datos. Borramos el del canónico
            -- (cascadea sus stage_results) y repuntamos el del duplicado.
            delete from public.match_entries where id = canon_entry_id;
            update public.match_entries
              set shooter_id = grp.canon_id
              where id = dup_entry.id;
            repointed := repointed + 1;
          else
            -- El canónico ya tiene un row igual o más rico. Borramos el
            -- del duplicado (cascadea sus stage_results).
            delete from public.match_entries where id = dup_entry.id;
            deleted := deleted + 1;
          end if;
        end if;
      end loop;

      -- Ya no hay match_entries apuntando al duplicado: lo eliminamos.
      delete from public.shooters where id = dup_id;

      canonical_id := grp.canon_id;
      duplicate_id := dup_id;
      entries_repointed := repointed;
      entries_deleted := deleted;
      return next;
    end loop;
  end loop;
end;
$$;


-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.profiles          enable row level security;
alter table public.disciplines       enable row level security;
alter table public.divisions         enable row level security;
alter table public.shooters          enable row level security;
alter table public.matches           enable row level security;
alter table public.stages            enable row level security;
alter table public.match_entries     enable row level security;
alter table public.stage_results     enable row level security;
alter table public.firearms          enable row level security;
alter table public.match_firearm_log enable row level security;
alter table public.clubs             enable row level security;
alter table public.audit_log         enable row level security;
alter table public.feedback          enable row level security;

-- ---------- profiles --------------------------------------------------
-- SELECT abierto a autenticados: display_name / número de socio no son
-- privados (aparecen en las planillas públicas de los torneos) y los
-- necesita la UI de "Importado por X". UPDATE solo el dueño.
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

-- ---------- disciplines / divisions (lookup tables) -------------------
-- Lectura para autenticados; escritura solo vía SQL editor (no la
-- exponemos por API).
create policy "disciplines_select_all"
  on public.disciplines for select using (auth.role() = 'authenticated');

create policy "divisions_select_all"
  on public.divisions for select using (auth.role() = 'authenticated');

-- ---------- shooters --------------------------------------------------
-- Lectura: cualquier autenticado (necesario para buscar y comparar).
-- Insert: cualquier autenticado (lo hace el importador).
-- Update (claim): solo si vas a linkearte vos mismo.
create policy "shooters_select_all"
  on public.shooters for select using (auth.role() = 'authenticated');

create policy "shooters_insert_authenticated"
  on public.shooters for insert with check (auth.role() = 'authenticated');

create policy "shooters_claim_self"
  on public.shooters for update
  using (auth.role() = 'authenticated')
  with check (
    linked_user_id is null or linked_user_id = auth.uid()
  );

-- ---------- matches ---------------------------------------------------
-- Lectura: todos los autenticados. Insert/Update/Delete: solo el importador.
create policy "matches_select_all"
  on public.matches for select using (auth.role() = 'authenticated');

create policy "matches_insert_authenticated"
  on public.matches for insert
  with check (auth.uid() = imported_by_user_id);

create policy "matches_update_importer"
  on public.matches for update
  using (auth.uid() = imported_by_user_id)
  with check (auth.uid() = imported_by_user_id);

create policy "matches_delete_importer"
  on public.matches for delete
  using (auth.uid() = imported_by_user_id);

-- ---------- stages, match_entries, stage_results ----------------------
-- Lectura: todos los autenticados. Insert/Update: solo el importador del
-- match (ownership directa o encadenada vía stage → match).
create policy "stages_select_all"
  on public.stages for select using (auth.role() = 'authenticated');

create policy "stages_insert_match_owner"
  on public.stages for insert
  with check (
    exists (
      select 1 from public.matches m
      where m.id = match_id and m.imported_by_user_id = auth.uid()
    )
  );

create policy "match_entries_select_all"
  on public.match_entries for select using (auth.role() = 'authenticated');

create policy "match_entries_insert_match_owner"
  on public.match_entries for insert
  with check (
    exists (
      select 1 from public.matches m
      where m.id = match_id and m.imported_by_user_id = auth.uid()
    )
  );

-- UPDATE necesario para el re-upload merge: Supabase ejecuta `upsert` como
-- INSERT ... ON CONFLICT DO UPDATE, y el branch UPDATE necesita su policy.
create policy "match_entries_update_match_owner"
  on public.match_entries for update
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_id and m.imported_by_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.matches m
      where m.id = match_id and m.imported_by_user_id = auth.uid()
    )
  );

create policy "stage_results_select_all"
  on public.stage_results for select using (auth.role() = 'authenticated');

create policy "stage_results_insert_match_owner"
  on public.stage_results for insert
  with check (
    exists (
      select 1 from public.stages s
      join public.matches m on m.id = s.match_id
      where s.id = stage_id and m.imported_by_user_id = auth.uid()
    )
  );

create policy "stage_results_update_match_owner"
  on public.stage_results for update
  using (
    exists (
      select 1 from public.stages s
      join public.matches m on m.id = s.match_id
      where s.id = stage_id and m.imported_by_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.stages s
      join public.matches m on m.id = s.match_id
      where s.id = stage_id and m.imported_by_user_id = auth.uid()
    )
  );

-- ---------- firearms / match_firearm_log ------------------------------
-- Datos privados. firearms: el dueño puede CRUD. match_firearm_log: el
-- firearm tiene que ser tuyo Y el match_entry tiene que pertenecer a algún
-- shooter linkeado a vos.
create policy "firearms_owner_all"
  on public.firearms for all
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy "match_firearm_log_owner_all"
  on public.match_firearm_log for all
  to authenticated
  using (
    exists (
      select 1 from public.firearms f
      where f.id = match_firearm_log.firearm_id
        and f.owner_user_id = auth.uid()
    )
    and exists (
      select 1 from public.match_entries me
      join public.shooters s on s.id = me.shooter_id
      where me.id = match_firearm_log.match_entry_id
        and s.linked_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.firearms f
      where f.id = match_firearm_log.firearm_id
        and f.owner_user_id = auth.uid()
    )
    and exists (
      select 1 from public.match_entries me
      join public.shooters s on s.id = me.shooter_id
      where me.id = match_firearm_log.match_entry_id
        and s.linked_user_id = auth.uid()
    )
  );

-- ---------- clubs -----------------------------------------------------
-- Lectura abierta para autenticados. CRUD vía SQL editor (sumar un club =
-- INSERT manual, sin redeploy).
create policy "clubs_select_authenticated"
  on public.clubs for select
  to authenticated
  using (true);

-- ---------- audit_log -------------------------------------------------
-- SELECT/INSERT solo del dueño: nadie ve ni inserta actividad de otro.
create policy "audit_log_select_own"
  on public.audit_log for select
  to authenticated
  using (auth.uid() = user_id);

create policy "audit_log_insert_own"
  on public.audit_log for insert
  to authenticated
  with check (auth.uid() = user_id);

-- ---------- feedback --------------------------------------------------
-- SELECT/INSERT solo del dueño. UPDATE/DELETE bloqueados a usuarios — el
-- admin actualiza status/admin_note vía SQL directo (service_role).
create policy "feedback_select_own"
  on public.feedback for select
  to authenticated
  using (auth.uid() = user_id);

create policy "feedback_insert_own"
  on public.feedback for insert
  to authenticated
  with check (auth.uid() = user_id);

commit;
