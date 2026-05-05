-- =====================================================================
-- HitFactor — schema inicial
-- =====================================================================
-- Tablas:
--   profiles, disciplines, divisions, shooters, matches, stages,
--   match_entries, stage_results, match_reports
-- =====================================================================

-- ---------- Helpers ---------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- profiles --------------------------------------------------
-- Extiende auth.users con info de perfil del usuario logueado.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  full_name    text,
  member_number text,
  default_region text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Crea el profile automáticamente cuando se registra un usuario.
-- Lee el display_name del raw_user_meta_data (lo seteamos en el signup).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, full_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data->>'full_name'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();


-- ---------- disciplines (lookup) --------------------------------------
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


-- ---------- divisions (lookup, por disciplina) ------------------------
create table public.divisions (
  id smallserial primary key,
  discipline_id smallint not null references public.disciplines(id) on delete cascade,
  code text not null,
  name text not null,
  unique (discipline_id, code)
);

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
  ((select id from public.disciplines where code = 'ipsc'), 'MS',   'Modified Shotgun');


-- ---------- shooters --------------------------------------------------
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


-- ---------- matches ---------------------------------------------------
-- Torneos. Los datos son públicos (cualquier usuario auth puede leer).
-- Solo el importador puede borrar. No hay edit (delete + reimport).
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
    'practiscore_pdf',
    'manual'
  )),
  source_filename text,
  imported_by_user_id uuid not null references auth.users(id) on delete restrict,
  imported_at timestamptz not null default now(),
  import_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Deduplicación: el mismo torneo no puede subirse dos veces.
  unique (discipline_id, name, date, region)
);

create index matches_discipline_date_idx on public.matches (discipline_id, date desc);
create index matches_importer_idx on public.matches (imported_by_user_id);

create trigger matches_set_updated_at
before update on public.matches
for each row execute function public.set_updated_at();


-- ---------- stages ----------------------------------------------------
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


-- ---------- match_entries --------------------------------------------
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
  is_dq boolean not null default false,
  created_at timestamptz not null default now(),
  -- Un tirador puede aparecer en una sola división por match.
  unique (match_id, shooter_id, division_id)
);

create index match_entries_match_idx on public.match_entries (match_id);
create index match_entries_shooter_idx on public.match_entries (shooter_id);


-- ---------- stage_results ---------------------------------------------
-- Resultado de un tirador en un stage (Tiro Práctico).
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
  is_dq boolean not null default false,
  created_at timestamptz not null default now(),
  unique (stage_id, match_entry_id)
);

create index stage_results_stage_idx on public.stage_results (stage_id);
create index stage_results_match_entry_idx on public.stage_results (match_entry_id);


-- ---------- match_reports ---------------------------------------------
-- Reportes de inconsistencia que un usuario puede levantar sobre un match.
create table public.match_reports (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  message text not null,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index match_reports_match_idx on public.match_reports (match_id);


-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.profiles      enable row level security;
alter table public.disciplines   enable row level security;
alter table public.divisions     enable row level security;
alter table public.shooters      enable row level security;
alter table public.matches       enable row level security;
alter table public.stages        enable row level security;
alter table public.match_entries enable row level security;
alter table public.stage_results enable row level security;
alter table public.match_reports enable row level security;

-- ---------- profiles --------------------------------------------------
-- Solo el dueño puede leer/escribir su perfil.
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

-- ---------- disciplines / divisions (lookup tables) -------------------
-- Lectura para todos los autenticados, escritura solo desde dashboard
-- (no la exponemos por API).
create policy "disciplines_select_all"
  on public.disciplines for select using (auth.role() = 'authenticated');

create policy "divisions_select_all"
  on public.divisions for select using (auth.role() = 'authenticated');

-- ---------- shooters --------------------------------------------------
-- Lectura: cualquier autenticado (necesario para buscar y comparar)
-- Insert: cualquier autenticado (lo hace el importador)
-- Update (claim): solo si vas a linkearte vos mismo o sos quien lo creó
create policy "shooters_select_all"
  on public.shooters for select using (auth.role() = 'authenticated');

create policy "shooters_insert_authenticated"
  on public.shooters for insert with check (auth.role() = 'authenticated');

create policy "shooters_claim_self"
  on public.shooters for update
  using (auth.role() = 'authenticated')
  with check (
    -- solo se puede setear linked_user_id al propio user
    linked_user_id is null or linked_user_id = auth.uid()
  );

-- ---------- matches ---------------------------------------------------
-- Lectura: todos los autenticados ven todos los matches.
-- Insert: cualquier autenticado puede importar.
-- Delete: solo el importador.
create policy "matches_select_all"
  on public.matches for select using (auth.role() = 'authenticated');

create policy "matches_insert_authenticated"
  on public.matches for insert
  with check (auth.uid() = imported_by_user_id);

create policy "matches_delete_importer"
  on public.matches for delete
  using (auth.uid() = imported_by_user_id);

-- ---------- stages, match_entries, stage_results ----------------------
-- Lectura: todos los autenticados.
-- Insert/Delete: solo a través del importador del match (cascade).
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

-- ---------- match_reports ---------------------------------------------
-- Lectura: el reportador y el importador del match pueden ver el reporte.
-- Insert: cualquier autenticado.
-- Update (cambiar status): solo el importador del match.
create policy "match_reports_select_visible"
  on public.match_reports for select
  using (
    auth.uid() = reporter_user_id
    or exists (
      select 1 from public.matches m
      where m.id = match_id and m.imported_by_user_id = auth.uid()
    )
  );

create policy "match_reports_insert_authenticated"
  on public.match_reports for insert
  with check (auth.uid() = reporter_user_id);

create policy "match_reports_update_match_owner"
  on public.match_reports for update
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_id and m.imported_by_user_id = auth.uid()
    )
  );
