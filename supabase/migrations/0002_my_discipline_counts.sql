-- =====================================================================
-- HitFactor — RPC my_discipline_counts
-- =====================================================================
-- Optimización: el sidebar (AppSidebar) muestra las disciplinas en las que
-- el usuario tiene participaciones, con su conteo. Eso corre en CADA page
-- load de la app.
--
-- Antes lo resolvía `listMyDisciplines` trayéndose TODAS las match_entries
-- del usuario (con joins a matches/disciplines) y contando en JS. Para un
-- tirador activo con decenas de torneos eran decenas de filas joineadas
-- transferidas en cada navegación.
--
-- Esta función hace la agregación en Postgres y devuelve a lo sumo 4 filas
-- (una por disciplina). El cliente solo mapea el resultado.
--
-- `p_user_id` va como parámetro (no usa auth.uid()) para que sea explícito
-- y testeable. No es un límite de seguridad: match_entries/shooters/matches/
-- disciplines ya son legibles por cualquier autenticado vía RLS, así que
-- esto no expone nada que el caller no pudiera computar por su cuenta.
-- `stable`: no muta nada y da el mismo resultado dentro de una transacción.
-- =====================================================================

create or replace function public.my_discipline_counts(p_user_id uuid)
returns table (code text, name text, count bigint)
language sql
stable
as $$
  select d.code, d.name, count(*)::bigint as count
  from public.match_entries me
  join public.shooters s   on s.id = me.shooter_id
  join public.matches m    on m.id = me.match_id
  join public.disciplines d on d.id = m.discipline_id
  where s.linked_user_id = p_user_id
  group by d.code, d.name
  order by count(*) desc;
$$;
