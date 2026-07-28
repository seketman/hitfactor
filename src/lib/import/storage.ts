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

/** Límite del bucket, replicado para poder validar antes de subir. */
export const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;

/** Referencia a un archivo ya subido: path en el bucket + nombre original. */
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
  return Promise.all(
    uploads.map(async ({ path, filename }) => {
      const { data, error } = await supabase.storage
        .from(IMPORT_BUCKET)
        .download(path);

      if (error || !data) {
        throw new Error(
          `No pudimos leer "${filename}" del almacenamiento. ` +
            "Volvé a subirlo e intentá de nuevo.",
        );
      }

      return {
        data: new Uint8Array(await data.arrayBuffer()),
        filename,
      };
    }),
  );
}

/**
 * Borra los archivos de staging. Se llama siempre que terminamos con
 * ellos — importó bien, falló el parseo, o el formato no se reconoció.
 *
 * Nunca tira: si la limpieza falla, el import ya fue y no queremos
 * convertir un éxito en un error por un archivo temporal que quedó. Los
 * huérfanos los barre el job del bucket.
 */
export async function cleanupImportFiles(
  supabase: TypedSupabaseClient,
  uploads: UploadedImportFile[],
): Promise<void> {
  if (uploads.length === 0) return;
  try {
    await supabase.storage
      .from(IMPORT_BUCKET)
      .remove(uploads.map((u) => u.path));
  } catch {
    // Best-effort a propósito. Ver el doc-comment.
  }
}
