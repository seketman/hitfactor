-- =====================================================================
-- HitFactor — Bucket de staging para archivos de import
-- =====================================================================
-- Problema: los reportes se subían dentro del FormData del server action
-- de /import. Vercel corta el body de una Function en 4.5 MB a nivel
-- plataforma (413 FUNCTION_PAYLOAD_TOO_LARGE) *antes* de invocar el
-- código, así que `experimental.serverActions.bodySizeLimit` de Next no
-- puede levantar ese techo — solo aplica en dev local. Un PDF de stages
-- WinMSS de 144 páginas pesa ~8 MB y no había forma de importarlo.
--
-- Solución: el browser sube el archivo directo a Storage (no pasa por la
-- Function) y el server action recibe solo el path, baja el objeto
-- server-side y lo parsea. El límite pasa a ser el del bucket.
--
-- El bucket es de staging: los objetos se borran apenas termina el
-- import. Si un upload queda huérfano (el usuario cierra la pestaña
-- entre el upload y el submit) queda un archivo colgado — ver la nota de
-- limpieza al final.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values (
  'match-imports',
  'match-imports',
  false,
  -- 20 MB. El WinMSS más pesado que vimos son ~8 MB (144 páginas con
  -- fuentes sin subsetear), así que esto deja margen de sobra sin
  -- habilitar uploads absurdos.
  20971520
)
on conflict (id) do nothing;

-- `allowed_mime_types` queda en null a propósito: el Content-Type que
-- manda el browser para .csv y .html es inconsistente entre sistemas
-- operativos (text/csv, application/vnd.ms-excel, o vacío), así que
-- filtrar por MIME acá rechazaría archivos válidos. El gate real de
-- formato sigue siendo la whitelist de extensiones del server action
-- más la detección de formato del parser.

-- ---------------------------------------------------------------------
-- RLS: cada usuario solo toca su propia carpeta
-- ---------------------------------------------------------------------
-- Convención de path: `<user_id>/<uuid>.<ext>`. Las policies validan
-- que el primer segmento sea el uid del JWT, así un usuario no puede
-- escribir ni leer los archivos de otro.

create policy "match_imports_insert_own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'match-imports'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

-- SELECT es necesario para que el server action pueda hacer `.download()`
-- con la sesión del usuario.
create policy "match_imports_select_own"
on storage.objects for select
to authenticated
using (
  bucket_id = 'match-imports'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

-- DELETE: la limpieza post-import corre con la sesión del usuario.
create policy "match_imports_delete_own"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'match-imports'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

-- ---------------------------------------------------------------------
-- Limpieza de huérfanos
-- ---------------------------------------------------------------------
-- El happy path borra el objeto apenas termina el parseo. Para los que
-- quedan colgados (pestaña cerrada a mitad de camino), conviene barrer
-- periódicamente. Si el proyecto tiene pg_cron habilitado:
--
--   select cron.schedule(
--     'purge-stale-match-imports',
--     '0 4 * * *',
--     $$ delete from storage.objects
--        where bucket_id = 'match-imports'
--          and created_at < now() - interval '1 day' $$
--   );
--
-- Se deja documentado y no ejecutado: pg_cron no está habilitado en este
-- proyecto hoy y activarlo es una decisión de infra, no de esta
-- migración.
