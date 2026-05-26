-- =====================================================================
-- HitFactor — Flag de administrador en profiles
-- =====================================================================
-- Agrega `profiles.is_admin` para habilitar funcionalidades de
-- diagnóstico restringidas a administradores del sitio (ej. ver el
-- dashboard "como otro tirador" para reproducir bugs o validar fixes).
--
-- Default false: la columna existe para todos pero nadie es admin
-- hasta que se promueva manualmente vía SQL:
--
--   UPDATE public.profiles SET is_admin = true WHERE id = '<your-uuid>';
--
-- La columna es NOT NULL para que el código pueda chequear
-- `profile.is_admin === true` sin acordarse de un null fallback.
-- =====================================================================

alter table public.profiles
  add column is_admin boolean not null default false;

comment on column public.profiles.is_admin is
  'True si el usuario tiene permisos de administrador (acceso a vistas de diagnóstico). Bootstrap manual vía UPDATE.';
