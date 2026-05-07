-- =====================================================================
-- HitFactor — catálogo de clubs en la DB
-- =====================================================================
-- Antes de esta migración, el catálogo vivía hardcoded en src/lib/clubs.ts.
-- Lo movemos a la DB para poder agregar clubs nuevos sin redeployar.
--
-- La tabla `matches.region` sigue siendo un text suelto (puede contener
-- "ARG-TFALP", "TFALP", o un texto libre cuando el importador eligió "Otro..."
-- al editar el club). El catálogo solo alimenta el dropdown de la UI; no
-- imponemos FK para no romper el free-text fallback.
-- =====================================================================

create table public.clubs (
  code text primary key,
  name text not null,
  country text,
  created_at timestamptz not null default now()
);

-- Seed inicial: lo que estaba en src/lib/clubs.ts.
insert into public.clubs (code, name, country) values
  ('TFALP', 'Tiro Federal Argentino de La Plata',  'ARG'),
  ('TFLZ',  'Tiro Federal de Lomas de Zamora',     'ARG'),
  ('TFABA', 'Tiro Federal Argentino Buenos Aires', 'ARG'),
  ('TFBA',  'Tiro Federal Buenos Aires',           'ARG'),
  ('ATyGQ', 'Asociación Tiradores y Gimnasia Quilmes', 'ARG')
on conflict (code) do nothing;

-- RLS: lectura abierta para autenticados. CRUD se hace vía SQL editor por
-- ahora (sumar un club nuevo = INSERT manual en Supabase, sin redeploy).
alter table public.clubs enable row level security;

create policy "clubs_select_authenticated"
  on public.clubs for select
  to authenticated
  using (true);
