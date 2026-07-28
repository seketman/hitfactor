import { createClient } from "@/lib/supabase/client";
import {
  IMPORT_BUCKET,
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

/**
 * El `filename` viaja aparte del `path` a propósito. Los parsers lo usan
 * como dato de entrada — el de la FAT deriva nombre y fecha del torneo
 * del nombre del archivo, y el de Steel Challenge lo usa para ordenar
 * los stages. Si mandáramos solo el path (que es un uuid), romperíamos
 * esos formatos.
 */
export type { UploadedImportFile };

/** Códigos de error del upload. La UI los traduce; ver `ImportForm`. */
export type UploadErrorCode = "not_authenticated" | "too_large" | "upload_failed";

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

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new ImportUploadError("not_authenticated");
  }

  for (const file of files) {
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      throw new ImportUploadError("too_large", file.name);
    }
  }

  // En paralelo: son pocos archivos (1, o N stages de Steel) y cada uno
  // es independiente. Si uno falla, `Promise.all` rechaza y el usuario
  // reintenta el import completo — los que sí subieron quedan huérfanos
  // y los barre la limpieza del bucket.
  return Promise.all(
    files.map(async (file) => {
      const path = `${user.id}/${crypto.randomUUID()}${extensionOf(file.name)}`;
      const { error } = await supabase.storage
        .from(IMPORT_BUCKET)
        .upload(path, file, {
          // Sin upsert: el path lleva un uuid, nunca colisiona. Además
          // upsert exigiría policies de UPDATE que no queremos dar.
          upsert: false,
          contentType: file.type || "application/octet-stream",
        });

      if (error) {
        throw new ImportUploadError("upload_failed", file.name);
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
