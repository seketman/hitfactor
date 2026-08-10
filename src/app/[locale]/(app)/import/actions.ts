"use server";

import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { parseFile, parsePdf, parsePdfBatch } from "@/lib/parsers";
import type { ParsedMatch } from "@/lib/types/match";
import { redirectWithError } from "@/lib/redirects";
import { isValidIsoDate } from "@/lib/dates";
import { requireUser } from "@/lib/supabase/require-user";
import { AUDIT_ACTION, logAction } from "@/lib/audit/log-action";
import type { TypedSupabaseClient } from "@/lib/supabase/types";
import {
  importParsedMatch,
  ImportError,
  type ImportOptions,
  type ImportResult,
} from "@/lib/import/import-match";
import {
  cleanupImportFiles,
  downloadImportFiles,
  parseUploadedRef,
  purgeStaleUploads,
  MAX_IMPORT_FILES,
  type UploadedImportFile,
} from "@/lib/import/storage";
import type { UploadErrorCode } from "@/lib/import/upload-to-storage";
import { ParserError } from "@/lib/parsers/parser-error";

/**
 * Traduce a texto para el usuario lo que salió mal en un import.
 *
 * Se usa tanto para fallas de descarga como de parseo, y por eso el nombre no
 * dice "parser": solo el segundo caso produce `ParserError`.
 *
 * Los parsers tiran `ParserError` con un código en vez de prosa, porque son
 * funciones puras y threadearles un traductor por toda la cadena de llamadas
 * sería invasivo. La traducción se hace acá, que es el primer punto del
 * camino donde hay locale — y así el querystring de `/import` sigue llevando
 * texto ya resuelto, sin cambiar su contrato.
 *
 * Un `Error` común (bug, falla de red) se pasa tal cual: no es texto pensado
 * para el usuario, pero ocultarlo detrás de un mensaje genérico haría más
 * difícil diagnosticar desde un reporte.
 */
type ActionTranslator = Awaited<
  ReturnType<typeof getTranslations<"actionError">>
>;

async function userFacingErrorMessage(e: unknown, fallbackKey: string) {
  const t = await getTranslations("import");
  if (e instanceof ParserError) {
    return t(`parserError.${e.code}`, e.params);
  }
  return e instanceof Error ? e.message : t(fallbackKey);
}

/**
 * Estado del form de import (`useActionState`).
 *
 *  - `idle`: estado inicial / después de remontar el form.
 *  - `needsDate`: el archivo se parseó OK pero es un ranking PDF de la FAT,
 *    que no trae fecha. Guardamos el `ParsedMatch` ya parseado para
 *    terminar la importación en el segundo submit, cuando el usuario
 *    completa la fecha (y opcionalmente corrige el nombre del torneo).
 *
 * Los caminos de éxito y de error siguen redirigiendo (a `/import?ok=...`
 * o `/import?error=...`) como antes; `useActionState` solo se usa para el
 * paso extra de la fecha.
 */
export type ImportFormState =
  | { status: "idle" }
  | {
      /**
       * Falló la subida del archivo a Storage, así que el server action
       * ni se llamó. Es el único estado que produce el cliente (ver el
       * wrapper `uploadThenImport` en `ImportForm`): los archivos ya no
       * viajan en el FormData, los sube el browser directo al bucket.
       *
       * Viaja el `code` y no el mensaje ya armado porque las traducciones
       * viven en `messages/`, no acá.
       */
      status: "uploadFailed";
      code: UploadErrorCode;
      filename: string | null;
    }
  | {
      status: "needsDate";
      parsed: ParsedMatch;
      filename: string;
      disciplineLabel: string;
      entriesCount: number;
      divisions: string[];
      /**
       * `min_shots` que el usuario completó en el primer submit. Lo
       * preservamos para usarlo en el segundo (FAT pide fecha en una
       * pantalla aparte; no queremos hacerle reingresar el mínimo).
       */
      minShots: number | null;
      /** Error del segundo submit (no perdemos el ParsedMatch). */
      error?: string;
    };

/** Etiqueta legible de disciplina para la pantalla de "falta la fecha". */
const DISCIPLINE_LABELS: Record<string, string> = {
  tiro_fbi: "Tiro FBI",
  ipsc: "Tiro Práctico (IPSC)",
  steel_challenge: "Steel Challenge",
  combat_solutions: "Combat Solutions",
};

export async function importHtml(
  prevState: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  const ta = await getTranslations("actionError");
  const locale = await getLocale();
  // Segundo submit: el usuario completó la fecha de un ranking de la FAT.
  if (prevState.status === "needsDate") {
    return confirmFatImport(prevState, formData, locale);
  }

  // Instrumentación de tiempos: queremos saber dónde se va el tiempo
  // (parser vs DB) y poder estimar futuros imports.
  const startedAt = new Date();
  const t0 = Date.now();

  // Autenticamos ANTES de validar nada. Dos razones: no hacemos trabajo
  // para un request sin sesión, y `cleanupImportFiles` necesita el
  // cliente de Supabase — sin él, cualquier salida temprana dejaba los
  // objetos que el browser ya subió tirados en el bucket para siempre.
  const { supabase, user } = await requireUser();

  // Mantenimiento oportunista: barremos los huérfanos viejos de este
  // usuario antes de arrancar. Filtra por antigüedad (24h), así que nunca
  // toca lo que se acaba de subir para este import. Nunca tira.
  await purgeStaleUploads(supabase, user.id);

  const { uploads, filename, allPdfs } = await resolveUploads(
    supabase,
    formData,
    locale,
    ta,
  );

  // `min_shots`: opcional en el form. Si está vacío o no parsea como int
  // positivo, queda null (el importer aplica 45 si es FBI; resto queda null).
  const minShots = parseMinShotsField(formData.get("min_shots"));

  console.log(
    `[import] start ${startedAt.toISOString()} files=${uploads.length} ` +
      `first=${uploads[0]!.filename}`,
  );

  // Bajamos del bucket con la sesión del usuario: la policy de SELECT
  // exige que el path esté bajo su carpeta, así que un path ajeno falla
  // acá aunque haya pasado la validación de forma.
  const tDownloadStart = Date.now();
  let downloaded;
  try {
    downloaded = await downloadImportFiles(supabase, uploads);
  } catch (e) {
    await cleanupImportFiles(supabase, uploads);
    const msg = await userFacingErrorMessage(e, "downloadFailed");
    // Log explícito: una falla de download (bucket, RLS, red, presupuesto
    // de bytes) es un problema de infra y hay que poder distinguirla de
    // un archivo con formato raro en los logs de producción.
    console.error(
      `[import] download falló file=${filename} files=${uploads.length}: ${msg}`,
    );
    redirectImportError(msg, filename, locale);
  }
  const tDownload = Date.now() - tDownloadStart;
  const totalSize = downloaded.reduce((acc, d) => acc + d.data.byteLength, 0);

  // PDFs van como binario (single o batch); HTML/CSV como texto (single only).
  let parsed: ParsedMatch;
  const tParseStart = Date.now();
  try {
    if (allPdfs && downloaded.length > 1) {
      parsed = await parsePdfBatch(downloaded);
    } else if (allPdfs) {
      const f = downloaded[0]!;
      parsed = await parsePdf(f.data, f.filename);
    } else {
      // HTML / CSV: un solo archivo, se procesa como texto. TextDecoder
      // asume UTF-8, igual que el `File.text()` que usábamos antes.
      const content = new TextDecoder().decode(downloaded[0]!.data);
      parsed = parseFile(content);
    }
  } catch (e) {
    await cleanupImportFiles(supabase, uploads);
    const msg = await userFacingErrorMessage(e, "parseFailed");
    // Incluimos el tamaño: es la señal que necesitamos para saber si los
    // fallos correlacionan con archivos grandes (timeout de la Function)
    // o con formatos que el parser no reconoce.
    console.error(
      `[import] parse falló file=${filename} bytes=${totalSize} ` +
        `download=${tDownload}ms: ${msg}`,
    );
    redirectImportError(msg, filename, locale);
  }
  const tParse = Date.now() - tParseStart;

  // Desde acá trabajamos sobre el `ParsedMatch`; los archivos de staging
  // ya no hacen falta ni siquiera en el camino de "falta la fecha".
  await cleanupImportFiles(supabase, uploads);

  if (!parsed.name) {
    redirectImportError(
      ta("notAValidReport"),
      filename,
      locale,
    );
  }

  // Los rankings PDF de la FAT no traen fecha. Si el parser no la pudo
  // sacar del nombre del archivo, frenamos acá y se la pedimos al usuario
  // (segundo submit) en vez de rechazar el import.
  if (!parsed.date) {
    if (parsed.source === "fat_pdf") {
      return {
        status: "needsDate",
        parsed,
        filename,
        disciplineLabel:
          DISCIPLINE_LABELS[parsed.discipline] ?? parsed.discipline,
        entriesCount: parsed.matchEntries.length,
        divisions: [...new Set(parsed.matchEntries.map((e) => e.divisionCode))],
        minShots,
      };
    }
    redirectImportError(
      ta("notAValidReport"),
      filename,
      locale,
    );
  }

  const result = await runImport(supabase, user.id, parsed, filename, locale, {
    minShots,
  });

  const tTotal = Date.now() - t0;
  console.log(
    `[import] done file=${filename} bytes=${totalSize} ` +
      `download=${tDownload}ms parse=${tParse}ms total=${tTotal}ms ` +
      `(${formatDurationHuman(tTotal)})`,
  );

  redirectToResult(result, locale);
}

/**
 * Resuelve y valida las referencias de archivos que mandó el cliente.
 *
 * Los archivos ya no viajan en el FormData: el browser los subió a
 * Supabase Storage y acá recibimos solo `{ path, filename }`. Es lo que
 * nos saca del techo de 4.5 MB que Vercel impone al body de una Function
 * — ver `@/lib/import/storage`.
 *
 * Cada salida por error limpia los objetos ya subidos antes de redirigir.
 * Esto no es opcional: para cuando este código corre, el browser ya
 * escribió en el bucket, y hoy no hay barrido automático de huérfanos
 * (issue #169). Un usuario que mezcla un CSV en un batch de Steel es un
 * error de tipeo, no debería dejar basura permanente.
 */
async function resolveUploads(
  supabase: TypedSupabaseClient,
  formData: FormData,
  locale: Locale,
  ta: ActionTranslator,
): Promise<{
  uploads: UploadedImportFile[];
  filename: string;
  allPdfs: boolean;
}> {
  const rawUploads = formData.getAll("upload").map(String);
  if (rawUploads.length === 0) {
    redirectWithError("/import", ta("chooseAFile"), locale);
  }

  const uploads: UploadedImportFile[] = [];
  const seenPaths = new Set<string>();
  for (const raw of rawUploads) {
    const ref = parseUploadedRef(raw);
    if (!ref) {
      // No hay nada validado que limpiar todavía más allá de lo que ya
      // juntamos, pero sí puede haber refs previas válidas.
      await cleanupImportFiles(supabase, uploads);
      redirectWithError("/import", ta("chooseAFile"), locale);
    }
    // Referencias repetidas: el mismo objeto N veces multiplicaba la
    // descarga sin subir nada nuevo. Es la forma más barata de abusar
    // del endpoint, y no tiene ningún uso legítimo.
    if (seenPaths.has(ref.path)) continue;
    seenPaths.add(ref.path);
    uploads.push(ref);
  }

  // Para reportes y errores: nombre del primer archivo si hay uno solo,
  // o un resumen "N archivos" si son varios.
  const filename =
    uploads.length === 1
      ? uploads[0]!.filename
      : `${uploads.length} archivos (${uploads[0]!.filename}, …)`;

  if (uploads.length > MAX_IMPORT_FILES) {
    await cleanupImportFiles(supabase, uploads);
    redirectImportError(
      ta("tooManyFiles", { max: MAX_IMPORT_FILES }),
      filename,
      locale,
    );
  }

  // Validación de extensiones — todos los archivos deben respetar el set
  // soportado. Si son varios, exigimos que todos sean PDF (es el único
  // formato que admite multi-file hoy: Steel Challenge).
  for (const u of uploads) {
    const isPdfFile = /\.pdf$/i.test(u.filename);
    const isTextFile = /\.(html?|csv)$/i.test(u.filename);
    if (!isPdfFile && !isTextFile) {
      await cleanupImportFiles(supabase, uploads);
      redirectImportError(
        ta("onlyHtmlCsvPdf"),
        filename,
        locale,
      );
    }
  }

  const allPdfs = uploads.every((u) => /\.pdf$/i.test(u.filename));
  if (uploads.length > 1 && !allPdfs) {
    await cleanupImportFiles(supabase, uploads);
    redirectImportError(
      ta("batchMustBeAllPdf"),
      filename,
      locale,
    );
  }

  return { uploads, filename, allPdfs };
}

/**
 * Segundo paso del import de un ranking FAT: el usuario ya completó la
 * fecha (y, si quiso, corrigió el nombre). Reusamos el `ParsedMatch` que
 * quedó guardado en el estado — no hace falta volver a parsear el PDF.
 */
async function confirmFatImport(
  prevState: Extract<ImportFormState, { status: "needsDate" }>,
  formData: FormData,
  locale: Locale,
): Promise<ImportFormState> {
  const ta = await getTranslations("actionError");
  const date = String(formData.get("date") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!isValidIsoDate(date)) {
    return { ...prevState, error: ta("invalidDate") };
  }

  const parsed: ParsedMatch = {
    ...prevState.parsed,
    date,
    name: name || prevState.parsed.name,
  };

  const { supabase, user } = await requireUser();

  let result: ImportResult;
  try {
    result = await importParsedMatch(
      supabase,
      parsed,
      user.id,
      prevState.filename,
      { minShots: prevState.minShots },
    );
  } catch (e) {
    if (e instanceof ImportError) {
      // No perdemos el trabajo del usuario: volvemos a la pantalla de
      // fecha con el error, conservando el ParsedMatch.
      return { ...prevState, parsed, error: e.message };
    }
    throw e;
  }

  await logImport(supabase, user.id, result);
  redirectToResult(result, locale);
}

/** Importa el `ParsedMatch` y loguea la acción. Errores conocidos → redirect. */
async function runImport(
  supabase: TypedSupabaseClient,
  userId: string,
  parsed: ParsedMatch,
  filename: string,
  locale: Locale,
  options: ImportOptions = {},
): Promise<ImportResult> {
  let result: ImportResult;
  try {
    result = await importParsedMatch(supabase, parsed, userId, filename, options);
  } catch (e) {
    if (e instanceof ImportError) {
      redirectImportError(e.message, filename, locale);
    }
    throw e;
  }
  await logImport(supabase, userId, result);
  return result;
}

/**
 * Variante de `redirectWithError` específica del flow de import: además
 * del mensaje, incluye en la URL el `lastFile` que el usuario intentó
 * subir, para que el form remontado tras el error muestre "Último
 * intento: X" como contexto y el usuario sepa qué re-elegir.
 */
function redirectImportError(
  message: string,
  lastFile: string,
  locale: Locale,
): never {
  redirect({
    href: { pathname: "/import", query: { error: message, lastFile } },
    locale,
  });
}

/**
 * Lee el campo `min_shots` del FormData. Devuelve `null` si está vacío,
 * mal formado o no es un entero positivo. La UI ya valida cliente-side
 * (input type=number min=1) pero blindamos el server-side igual.
 */
function parseMinShotsField(raw: FormDataEntryValue | null): number | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

async function logImport(
  supabase: TypedSupabaseClient,
  userId: string,
  result: ImportResult,
): Promise<void> {
  await logAction(supabase, userId, {
    action: AUDIT_ACTION.MATCH_IMPORT,
    entityType: "match",
    entityId: result.matchId,
    metadata: {
      match_name: result.matchName,
      match_date: result.matchDate,
      discipline_code: result.disciplineCode,
      discipline_name: result.disciplineName,
      entries_count: result.insertedEntries,
      stages_count: result.insertedStages,
      existed_already: result.existedAlready,
    },
  });
}

/** Redirige a `/import` con el resumen del import exitoso en el querystring. */
function redirectToResult(result: ImportResult, locale: Locale): never {
  const params: Record<string, string> = {
    ok: "1",
    matchId: result.matchId,
    name: result.matchName,
    discipline: result.disciplineName,
    entries: String(result.insertedEntries),
    stages: String(result.insertedStages),
    stageResults: String(result.insertedStageResults),
    existed: result.existedAlready ? "1" : "0",
  };
  // Avisos no-fatales del parser (ej. filas descartadas). Van en la URL para
  // que la página los muestre; si no hay, no ensuciamos la query string.
  if (result.warnings?.length) {
    params.warnings = result.warnings.join("\n");
  }
  redirect({ href: { pathname: "/import", query: params }, locale });
}

function formatDurationHuman(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${s % 60}s`;
}
