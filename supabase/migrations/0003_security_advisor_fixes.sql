-- =====================================================================
-- HitFactor — Fixes del Security Advisor de Supabase
-- =====================================================================
-- Resuelve los warnings reportados por el linter de seguridad (splinter).
--
--  1. "Function Search Path Mutable" (4 funciones)
--     Una función sin search_path fijo resuelve los nombres de objetos
--     según el search_path del caller. Eso permite que un objeto plantado
--     en otro schema "secuestre" una referencia sin calificar dentro de la
--     función. Las 4 funciones ya referencian todo con schema explícito
--     (public.x) o vía pg_catalog (now(), count(), lower()...), así que
--     fijar search_path = '' es seguro y NO cambia su comportamiento.
--     pg_catalog siempre se busca primero, fije lo que fije el search_path.
--
--  2. "Public / Signed-In Users Can Execute SECURITY DEFINER Function"
--     handle_new_user es una función trigger (corre on insert en
--     auth.users). No tiene por qué ser invocable directamente por nadie.
--     Postgres concede EXECUTE a PUBLIC por defecto al crear una función;
--     se lo revocamos. El trigger on_auth_user_created sigue funcionando:
--     la ejecución vía trigger no chequea el privilegio EXECUTE.
--
-- El warning "Leaked Password Protection Disabled" NO se arregla por SQL:
-- es un toggle de Auth en el dashboard (Authentication > Providers > Email).
-- =====================================================================

-- 1. Fijar search_path en las funciones flageadas.
alter function public.my_discipline_counts(uuid) set search_path = '';
alter function public.set_updated_at()           set search_path = '';
alter function public.feedback_set_updated_at()  set search_path = '';
alter function public.merge_duplicate_shooters() set search_path = '';

-- 2. Sacar el EXECUTE público de la función trigger SECURITY DEFINER.
--    anon/authenticated lo heredan de PUBLIC; los revocamos también de
--    forma explícita por si alguna migración futura concede directo.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
