-- =====================================================================
-- HitFactor — log de auditoría de acciones del usuario
-- =====================================================================
-- Registra cada mutación que el usuario hace sobre sus datos: claim de
-- shooters, asignación de armas a matches, edición/borrado de matches y
-- firearms, etc.
--
-- Diseño polimórfico: una sola tabla cubre todas las acciones. La
-- estructura de `metadata` cambia por acción pero el row shape es constante.
-- El convenio de `action` es "entidad.verbo" (ej: "shooter.claim",
-- "match_firearm.set"). Ver src/lib/audit/log-action.ts para los valores
-- canónicos.
-- =====================================================================

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

-- ---------- RLS -------------------------------------------------------
-- SELECT solo del dueño: nadie ve la actividad de otro.
-- INSERT solo si user_id matchea el auth uid: previene que un cliente
-- malicioso inserte filas falsas a nombre de otro usuario.
alter table public.audit_log enable row level security;

create policy "audit_log_select_own"
  on public.audit_log for select
  to authenticated
  using (auth.uid() = user_id);

create policy "audit_log_insert_own"
  on public.audit_log for insert
  to authenticated
  with check (auth.uid() = user_id);
