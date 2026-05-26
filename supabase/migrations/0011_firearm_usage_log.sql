-- =====================================================================
-- HitFactor — Log de uso de armas fuera de torneos (issue #47, fase A)
-- =====================================================================
-- Hasta ahora `match_firearm_log` cubre el caso "arma en un torneo".
-- Faltaba el caso entrenamiento / práctica: el tirador va al polígono,
-- dispara N tiros, y quiere registrar ese consumo para llevar el
-- desgaste real del arma + uso mensual de munición.
--
-- Decisiones de diseño:
--  - Tabla separada en vez de extender `match_firearm_log` con
--    `match_entry_id` nullable. Mezclar conceptos complicaría las
--    queries y la RLS (el log de match depende del shooter linkeado,
--    el manual depende solo del dueño del arma).
--  - Por ahora un solo "tipo" implícito (práctica). Si después aparecen
--    casos donde dry-fire / clase / lo-que-sea importa diferenciar,
--    agregamos `usage_type` sin migrar datos viejos.
--  - `rounds_fired > 0` (strict): cero tiros = no es un log útil; sería
--    ruido. Difiere de `match_firearm_log` (≥ 0) que tolera "no recuerdo".
--  - `used_on` es `date`, no timestamptz — al tirador le importa la
--    fecha del polígono, no la hora exacta.
--  - `ammunition_type_id` opcional, mismo patrón que `match_firearm_log`:
--    ON DELETE SET NULL preserva el log histórico aunque borren el tipo.
-- =====================================================================

create table public.firearm_usage_log (
  id uuid primary key default gen_random_uuid(),
  firearm_id uuid not null references public.firearms(id) on delete cascade,
  ammunition_type_id uuid
    references public.ammunition_types(id) on delete set null,
  used_on date not null,
  rounds_fired integer not null check (rounds_fired > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index firearm_usage_log_firearm_idx
  on public.firearm_usage_log (firearm_id);
create index firearm_usage_log_ammo_idx
  on public.firearm_usage_log (ammunition_type_id);

create trigger firearm_usage_log_set_updated_at
before update on public.firearm_usage_log
for each row execute function public.set_updated_at();

comment on column public.firearm_usage_log.used_on is
  'Fecha del consumo (entrenamiento / práctica). Solo fecha, no hora.';
comment on column public.firearm_usage_log.rounds_fired is
  'Tiros disparados en la sesión. Debe ser > 0; cero sería ruido.';

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.firearm_usage_log enable row level security;

-- El dueño del arma puede CRUD sobre sus logs. La RLS hace JOIN contra
-- firearms — no denormalizamos owner_user_id porque el dato vive en
-- firearms y mantenerlos sincronizados duplica responsabilidad.
create policy "firearm_usage_log_owner_all"
  on public.firearm_usage_log for all
  using (
    exists (
      select 1 from public.firearms f
      where f.id = firearm_id
        and f.owner_user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.firearms f
      where f.id = firearm_id
        and f.owner_user_id = (select auth.uid())
    )
  );
