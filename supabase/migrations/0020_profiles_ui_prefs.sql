-- =====================================================================
-- HitFactor — preferencias de UI por usuario
-- =====================================================================
-- Agrega `profiles.ui_prefs jsonb` para guardar settings que el usuario
-- elige desde la UI y queremos que persistan entre dispositivos/sesiones
-- (no en localStorage). El primer caso de uso es el tamaño de página del
-- listado de matches, pero la columna está abierta a futuros settings
-- (sort default, theme override, paginación de historial, etc.) para no
-- tener que agregar columnas/migrations por cada preferencia.
--
-- Esquema esperado en el JSON (no enforced en la DB — el cliente valida):
--   {
--     "matchesPageSize": 10 | 20 | 50 | 100
--   }
--
-- Default `'{}'::jsonb` para que filas viejas no rompan los reads.
-- =====================================================================

alter table public.profiles
  add column if not exists ui_prefs jsonb not null default '{}'::jsonb;

comment on column public.profiles.ui_prefs is
  'Preferencias de UI por usuario, persistidas server-side para que sigan al user entre dispositivos. JSON libre — la forma se valida en el cliente.';
