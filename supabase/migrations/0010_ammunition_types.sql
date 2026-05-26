-- =====================================================================
-- HitFactor — Catálogo de municiones (issue #46)
-- =====================================================================
-- Cada tirador puede registrar los tipos de munición que usa: factory
-- (compradas) y reload (recargadas por el tirador). Sirve para llevar
-- registro técnico (peso de punta, pólvora, factor declarado) y para
-- asociar opcionalmente cada uso de arma en un match (#47).
--
-- Patrón calcado de `firearms`: owner_user_id + RLS owner_all, columnas
-- nullables salvo nombre y tipo.
--
-- Decisiones de diseño:
--  - `type` es text con CHECK ('factory' | 'reload') — mismo patrón que
--    power_factor en match_entries. No usamos un enum para evitar la
--    fricción de migrar enums después.
--  - Los campos de recarga (powder, powder_charge_grains) son opcionales
--    incluso cuando type='reload' — algunos recargadores no logean cada
--    detalle, y un campo en blanco es más útil que bloquear la creación.
--  - `power_factor` es la declaración del tirador (Min/Maj). NO la
--    calculamos automáticamente desde bullet_weight × velocity porque no
--    pedimos la velocidad — eso requeriría un cronógrafo. Si el tirador
--    sabe el factor, lo declara.
-- =====================================================================

create table public.ammunition_types (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('factory', 'reload')),
  caliber text,
  brand text,
  bullet_weight_grains numeric(6,2),
  bullet_type text,
  powder text,
  powder_charge_grains numeric(6,3),
  power_factor text check (power_factor in ('Min', 'Maj') or power_factor is null),
  power_factor_measured numeric(7,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ammunition_types_owner_idx
  on public.ammunition_types (owner_user_id);

create trigger ammunition_types_set_updated_at
before update on public.ammunition_types
for each row execute function public.set_updated_at();

comment on column public.ammunition_types.type is
  'factory (compradas) o reload (recargadas por el tirador).';
comment on column public.ammunition_types.bullet_weight_grains is
  'Peso de la punta en grains (1 grain = 64.8 mg). Aplica tanto a factory como a reload.';
comment on column public.ammunition_types.powder_charge_grains is
  'Carga de pólvora en grains. Solo relevante para type=reload.';
comment on column public.ammunition_types.power_factor is
  'Factor declarado por el tirador (Min/Maj). No se calcula automáticamente — lo informa el tirador.';
comment on column public.ammunition_types.power_factor_measured is
  'Valor medido del power factor: peso de punta (grains) × velocidad (fps) / 1000. Independiente de power_factor: un tirador puede haber medido el valor exacto sin clasificar, o viceversa.';

-- ---------------------------------------------------------------------
-- Linking opcional con match_firearm_log
-- ---------------------------------------------------------------------
-- Cuando un tirador asigna un arma a un match_entry, opcionalmente
-- puede decir QUÉ munición usó. Nullable: la mayoría de los logs viejos
-- no van a tener este dato.
--
-- ON DELETE SET NULL en vez de CASCADE: borrar un tipo de munición no
-- debería destruir el historial de matches — solo desvincular.
alter table public.match_firearm_log
  add column ammunition_type_id uuid
    references public.ammunition_types(id) on delete set null;

create index match_firearm_log_ammunition_idx
  on public.match_firearm_log (ammunition_type_id);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.ammunition_types enable row level security;

-- Mismo modelo que firearms: el dueño puede CRUD sobre los suyos. No hay
-- política de SELECT pública — la munición de un tirador es privada.
create policy "ammunition_types_owner_all"
  on public.ammunition_types for all
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));
