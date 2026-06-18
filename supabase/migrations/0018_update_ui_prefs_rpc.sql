-- =====================================================================
-- HitFactor — RPC update_ui_prefs (merge atómico de ui_prefs)
-- =====================================================================
-- `db/profiles.ts updateUiPrefs` hacía read-modify-write en JS: leía
-- `ui_prefs`, mergeaba el patch y reescribía el JSON completo. Eso tiene dos
-- problemas (issue #126):
--   1. Lost update: dos updates concurrentes (ej. page-size + dismiss de
--      sugerencias) se pisan — el segundo write parte de un read previo al
--      primero.
--   2. El error del write se descartaba (la función devolvía void sin chequear).
--
-- Esta RPC hace el merge en una sola sentencia atómica con el operador `||`
-- de jsonb, sobre la fila del propio usuario (`auth.uid()`). Las keys que el
-- patch no toca se preservan; no hay ventana de carrera.
--
-- `security invoker` (default): corre con los permisos del caller, así la RLS
-- de `profiles` sigue aplicando (un usuario solo puede actualizar su fila).
-- `set search_path = ''`: mismo hardening que el resto de las funciones
-- (migración 0003) — todo va schema-qualified.
-- =====================================================================

create or replace function public.update_ui_prefs(patch jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.profiles
  set ui_prefs = coalesce(ui_prefs, '{}'::jsonb) || patch
  where id = (select auth.uid());
$$;

-- anon no tiene fila de profile (el where nunca matchea), pero revocamos
-- explícitamente para dejar la superficie de la API acotada a autenticados.
revoke execute on function public.update_ui_prefs(jsonb) from anon;
