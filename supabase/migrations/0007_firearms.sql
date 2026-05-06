-- =====================================================================
-- HitFactor — registro de armas y log de uso por torneo
-- =====================================================================
-- Permite a cada usuario llevar:
--  - Su catálogo de armas (tabla `firearms`).
--  - Qué arma usó en cada uno de sus match_entries y cuántos tiros disparó
--    (tabla `match_firearm_log`).
--
-- Datos privados: ningún otro usuario puede leer ni escribir tu inventario
-- ni tu uso. RLS por owner_user_id en `firearms` y por ownership encadenada
-- en `match_firearm_log` (firearm propio + match_entry de un shooter linkeado
-- al usuario).
-- =====================================================================

-- ---------- firearms --------------------------------------------------
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

-- ---------- match_firearm_log ----------------------------------------
-- Una sola arma por match_entry para el MVP (PK simple). Si después se
-- necesita backup-gun/swap, evoluciona a PK compuesta.
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

-- ---------- RLS -------------------------------------------------------
alter table public.firearms          enable row level security;
alter table public.match_firearm_log enable row level security;

-- firearms: el dueño puede CRUD.
create policy "firearms_owner_all"
  on public.firearms for all
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- match_firearm_log: el firearm tiene que ser tuyo y el match_entry tiene
-- que pertenecer a algún shooter linkeado a vos.
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
