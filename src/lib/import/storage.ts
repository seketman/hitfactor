import type { TypedSupabaseClient } from "@/lib/supabase/types";

/**
 * Lado server del staging de imports en Supabase Storage.
 *
 * El browser sube los archivos directo al bucket (ver
 * `upload-to-storage.ts`) porque Vercel corta el body de una Function en
 * 4.5 MB y los PDFs de stages WinMSS pasan holgado ese límite. Acá los
 * bajamos de vuelta para parsearlos, y los borramos apenas terminamos.
 *
 * Este módulo no importa el cliente de browser a propósito: las
 * constantes compartidas viven acá para que el bundle del cliente no se
 * lleve nada del server ni al revés.
 */

/** Bucket de staging. Ver `supabase/migrations/0020_import_uploads_storage.sql`. */
export const IMPORT_BUCKET = "match-imports";

/**
 * Límite por archivo del bucket, replicado para validar antes de subir.
 *
 * Si cambiás esto, cambiá también `file_size_limit` en la migración 0020
 * y el `{size}` de `import.form.uploadError.too_large` sale solo (se
 * deriva de esta constante, no está hardcodeado en `messages/`).
 */
export const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Máximo de archivos por import.
 *
 * El caso legítimo más grande es Steel Challenge con un PDF por stage;
 * un torneo largo ronda los 24. 32 deja margen sin volverse una vía de
 * abuso.
 *
 * Ojo con por qué esto existe: antes del bucket, el techo de 4.5 MB que
 * Vercel impone al body acotaba esto sin que nadie lo decidiera. Ahora
 * las referencias son JSON de ~100 bytes y entran miles en un request,
 * así que el límite tiene que ser explícito.
 */
export const MAX_IMPORT_FILES = 32;

/**
 * Techo de bytes acumulados por import. Cortamos la descarga apenas se
 * cruza, para que un usuario no pueda hacer que la Function se traiga
 * cientos de MB en una sola invocación.
 */
export const MAX_IMPORT_TOTAL_BYTES = 64 * 1024 * 1024;

/**
 * Referencia a un archivo ya subido: path en el bucket + nombre original.
 *
 * El `filename` viaja aparte del `path` a propósito. Los parsers lo usan
 * como dato de entrada — el de la FAT deriva nombre y fecha del torneo
 * del nombre del archivo, y el de Steel Challenge lo usa para ordenar
 * los stages. El path es un uuid: si mandáramos solo eso, romperíamos
 * esos formatos.
 */
export interface UploadedImportFile {
  path: string;
  filename: string;
}

/** Un archivo bajado del bucket, listo para el parser. */
export interface DownloadedImportFile {
  data: Uint8Array;
  filename: string;
}

/**
 * Valida que lo que vino en el FormData sea una referencia a un archivo
 * del bucket y no cualquier cosa.
 *
 * El path lo arma el cliente, así que es input no confiable. Las
 * policies de RLS ya impiden leer la carpeta de otro usuario, pero
 * igual exigimos la forma `<uuid>/<uuid>.<ext>` para no depender de una
 * sola capa y para fallar temprano con un error claro.
 */
export function parseUploadedRef(raw: string): UploadedImportFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const { path, filename } = parsed as Record<string, unknown>;
  if (typeof path !== "string" || typeof filename !== "string") return null;
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}(\.[a-z0-9]+)?$/i.test(path)) return null;
  if (filename.length === 0 || filename.length > 255) return null;

  return { path, filename };
}

/**
 * Baja los archivos del bucket para pasárselos al parser.
 *
 * Corre con la sesión del usuario (no service role): la policy de SELECT
 * exige que el primer segmento del path sea su uid, así que un path de
 * otro usuario devuelve error acá aunque haya pasado la validación de
 * forma.
 */
export async function downloadImportFiles(
  supabase: TypedSupabaseClient,
  uploads: UploadedImportFile[],
): Promise<DownloadedImportFile[]> {
  // Secuencial y no `Promise.all`: así el presupuesto de bytes corta
  // apenas se cruza, en vez de tener N descargas grandes ya en vuelo. El
  // caso común es un solo archivo, donde no hay diferencia; el peor caso
  // legítimo son ~24 PDFs de Steel de un par de cientos de KB, que en
  // serie siguen siendo despreciables al lado del parseo.
  const downloaded: DownloadedImportFile[] = [];
  let totalBytes = 0;

  for (const { path, filename } of uploads) {
    const { data, error } = await supabase.storage
      .from(IMPORT_BUCKET)
      .download(path);

    if (error || !data) {
      throw new Error(
        `No pudimos leer "${filename}" del almacenamiento. ` +
          "Volvé a subirlo e intentá de nuevo.",
      );
    }

    totalBytes += data.size;
    if (totalBytes > MAX_IMPORT_TOTAL_BYTES) {
      throw new Error(
        `El import supera el máximo de ${formatMb(MAX_IMPORT_TOTAL_BYTES)} ` +
          "entre todos los archivos. Subilos en tandas más chicas.",
      );
    }

    downloaded.push({
      data: new Uint8Array(await data.arrayBuffer()),
      filename,
    });
  }

  return downloaded;
}

/** `20 MB` a partir de un valor en bytes. Para mensajes al usuario. */
export function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * Borra los archivos de staging. Se llama siempre que terminamos con
 * ellos — importó bien, falló el parseo, o el formato no se reconoció.
 *
 * Nunca tira: si la limpieza falla, el import ya fue y no queremos
 * convertir un éxito en un error por un archivo temporal que quedó.
 *
 * OJO: hoy no hay ningún barrido automático de huérfanos. El job de
 * `pg_cron` está escrito y comentado en la migración 0020 pero NO está
 * activo (issue #169). O sea que lo que no se borre acá queda para
 * siempre — por eso logueamos el fallo en vez de tragarlo en silencio.
 */
export async function cleanupImportFiles(
  supabase: TypedSupabaseClient,
  uploads: UploadedImportFile[],
): Promise<void> {
  if (uploads.length === 0) return;
  try {
    const { error } = await supabase.storage
      .from(IMPORT_BUCKET)
      .remove(uploads.map((u) => u.path));
    if (error) {
      console.error(
        `[import] cleanup falló (${uploads.length} objetos huérfanos): ` +
          error.message,
      );
    }
  } catch (e) {
    console.error(
      `[import] cleanup tiró (${uploads.length} objetos huérfanos):`,
      e,
    );
  }
}
