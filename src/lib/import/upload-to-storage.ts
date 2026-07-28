import { createClient } from "@/lib/supabase/client";
import {
  IMPORT_BUCKET,
  MAX_IMPORT_FILES,
  MAX_IMPORT_FILE_BYTES,
  type UploadedImportFile,
} from "./storage";

/**
 * Subida de los archivos de import a Supabase Storage, desde el browser.
 *
 * Por qué existe: los reportes viajaban dentro del FormData del server
 * action de /import, y Vercel corta el body de una Function en 4.5 MB a
 * nivel plataforma (413) antes de invocar el código — el
 * `bodySizeLimit` de Next no puede levantar ese techo. Un PDF de stages
 * WinMSS de 144 páginas pesa ~8 MB, así que directamente no entraba.
 *
 * Ahora el archivo va del browser a Storage sin pasar por la Function, y
 * el server action recibe solo el path para bajarlo server-side. El
 * parser sigue corriendo en el server (ver `docs/parsers.md`): acá no
 * hacemos ninguna interpretación del contenido.
 */

export type { UploadedImportFile };

/**
 * Códigos de error del upload. La UI los traduce; ver `ImportForm`.
 *
 * `bucket_missing` existe para separar "se rompió la red" de "el bucket
 * no está" — este último pasa si se deploya el código sin correr la
 * migración 0020, y confundirlo con un problema de conexión manda al
 * usuario a revisar su wifi por una falla de configuración del server.
 */
export type UploadErrorCode =
  | "not_authenticated"
  | "too_large"
  | "too_many"
  | "bucket_missing"
  | "upload_failed";

export class ImportUploadError extends Error {
  constructor(
    readonly code: UploadErrorCode,
    /** Nombre del archivo que falló, para poder nombrarlo en el mensaje. */
    readonly filename: string | null = null,
  ) {
    super(code);
    this.name = "ImportUploadError";
  }
}

/**
 * Sube los archivos elegidos y devuelve sus paths en el bucket.
 *
 * Path: `<user_id>/<uuid>.<ext>`. El prefijo con el uid no es cosmético
 * — las policies de RLS validan que el primer segmento sea el uid del
 * JWT, así que es lo que impide que un usuario escriba o lea la carpeta
 * de otro.
 */
export async function uploadImportFiles(
  files: File[],
): Promise<UploadedImportFile[]> {
  const supabase = createClient();

  // `getUser()` pega a la red, así que puede tirar por su cuenta. Sin
  // este try el error escapaba del wrapper del form y reventaba como
  // error de render en vez de mostrar el estado de "falló la subida".
  let userId: string;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new ImportUploadError("not_authenticated");
    userId = user.id;
  } catch (e) {
    if (e instanceof ImportUploadError) throw e;
    throw new ImportUploadError("not_authenticated");
  }

  if (files.length > MAX_IMPORT_FILES) {
    throw new ImportUploadError("too_many");
  }

  for (const file of files) {
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      throw new ImportUploadError("too_large", file.name);
    }
  }

  // En paralelo: son pocos archivos (1, o N stages de Steel) y cada uno
  // es independiente.
  //
  // Si uno falla, `Promise.all` rechaza y el usuario reintenta el import
  // completo — los que ya subieron quedan huérfanos. Los levanta
  // `purgeStaleUploads` (ver `./storage`) en el próximo import de este
  // mismo usuario, un día después.
  return Promise.all(
    files.map(async (file) => {
      const path = `${userId}/${crypto.randomUUID()}${extensionOf(file.name)}`;
      const { error } = await supabase.storage
        .from(IMPORT_BUCKET)
        .upload(path, file, {
          // Sin upsert: el path lleva un uuid, nunca colisiona. Además
          // upsert exigiría policies de UPDATE que no queremos dar.
          upsert: false,
          contentType: file.type || "application/octet-stream",
        });

      if (error) {
        // Un bucket inexistente es una falla de configuración del server
        // (falta correr la migración), no un problema del usuario.
        const code: UploadErrorCode = /bucket not found/i.test(error.message)
          ? "bucket_missing"
          : "upload_failed";
        throw new ImportUploadError(code, file.name);
      }

      return { path, filename: file.name };
    }),
  );
}

/** `.pdf` de "reporte.pdf"; string vacío si no tiene extensión. */
function extensionOf(filename: string): string {
  const match = /\.[a-z0-9]+$/i.exec(filename);
  return match ? match[0].toLowerCase() : "";
}
