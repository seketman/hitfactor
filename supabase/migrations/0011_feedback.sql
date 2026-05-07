-- =====================================================================
-- HitFactor — feedback / bug reports de usuarios
-- =====================================================================
-- Captura reportes de bugs y sugerencias enviados desde la página /about.
-- El admin (Seketman) los lee con SQL directo en Supabase para armar el
-- backlog. Los usuarios ven solo sus propios reportes con su estado.
-- =====================================================================

create table public.feedback (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('bug', 'suggestion', 'other')),
  message text not null check (char_length(message) between 10 and 4000),
  page_url text,
  -- Status neutros: aplican a cualquier `type`. La UI rendea el label
  -- según `(status, type)` — ej: `done` muestra "Resuelto" para bug y
  -- "Implementada" para suggestion. Ver render en /about.
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

-- Trigger para mantener updated_at en sync.
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

-- ---------- RLS -------------------------------------------------------
-- SELECT solo del dueño: cada usuario ve sus propios reportes y el status
-- que el admin les asignó.
-- INSERT solo si user_id matchea auth uid: previene reportes a nombre ajeno.
-- UPDATE/DELETE: bloqueados a usuarios. El admin actualiza status/admin_note
-- vía SQL directo (service_role bypassa RLS).
alter table public.feedback enable row level security;

create policy "feedback_select_own"
  on public.feedback for select
  to authenticated
  using (auth.uid() = user_id);

create policy "feedback_insert_own"
  on public.feedback for insert
  to authenticated
  with check (auth.uid() = user_id);
