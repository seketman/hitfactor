"use server";

import { redirect } from "next/navigation";
import { parseFile, parsePdf, parsePdfBatch } from "@/lib/parsers";
import type { ParsedMatch } from "@/lib/types/match";
import { redirectWithError } from "@/lib/redirects";
import { requireUser } from "@/lib/supabase/require-user";
import { AUDIT_ACTION, logAction } from "@/lib/audit/log-action";
import type { TypedSupabaseClient } from "@/lib/supabase/types";
import {
  importParsedMatch,
  ImportError,
  type ImportOptions,
  type ImportResult,
} from "@/lib/import/import-match";

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
  // Segundo submit: el usuario completó la fecha de un ranking de la FAT.
  if (prevState.status === "needsDate") {
    return confirmFatImport(prevState, formData);
  }

  // Instrumentación de tiempos: queremos saber dónde se va el tiempo
  // (parser vs DB) y poder estimar futuros imports.
  const startedAt = new Date();
  const t0 = Date.now();

  // Multi-file: el input acepta `multiple`, principalmente para Steel
  // Challenge donde cada stage viene en su propio PDF. El path de un solo
  // archivo (HTML/CSV/PDF) sigue funcionando idéntico.
  const rawFiles = formData.getAll("file");
  const files = rawFiles.filter(
    (f): f is File => f instanceof File && f.size > 0,
  );
  if (files.length === 0) {
    redirectWithError("/import", "Elegí un archivo");
  }

  // Para reportes y errores: nombre del primer archivo si hay uno solo,
  // o un resumen "N archivos" si son varios.
  const filename =
    files.length === 1
      ? files[0]!.name
      : `${files.length} archivos (${files[0]!.name}, …)`;

  // Validación de extensiones — todos los archivos deben respetar el set
  // soportado. Si son varios, exigimos que todos sean PDF (es el único
  // formato que admite multi-file hoy: Steel Challenge).
  for (const f of files) {
    const isPdfFile = /\.pdf$/i.test(f.name);
    const isTextFile = /\.(html?|csv)$/i.test(f.name);
    if (!isPdfFile && !isTextFile) {
      redirectImportError(
        "Solo se aceptan archivos HTML, CSV o PDF",
        filename,
      );
    }
  }
  const allPdfs = files.every((f) => /\.pdf$/i.test(f.name));
  if (files.length > 1 && !allPdfs) {
    redirectImportError(
      "Para subir varios archivos a la vez todos tienen que ser PDFs " +
        "(es el formato multi-archivo soportado, típicamente Steel Challenge).",
      filename,
    );
  }

  // `min_shots`: opcional en el form. Si está vacío o no parsea como int
  // positivo, queda null (el importer aplica 45 si es FBI; resto queda null).
  const minShots = parseMinShotsField(formData.get("min_shots"));

  const totalSize = files.reduce((acc, f) => acc + f.size, 0);
  console.log(
    `[import] start ${startedAt.toISOString()} files=${files.length} ` +
      `first=${files[0]!.name} totalSize=${totalSize}b`,
  );

  const { supabase, user } = await requireUser();

  // PDFs van como binario (single o batch); HTML/CSV como texto (single only).
  let parsed: ParsedMatch;
  const tParseStart = Date.now();
  try {
    if (allPdfs && files.length > 1) {
      const buffers = await Promise.all(
        files.map(async (f) => ({
          data: new Uint8Array(await f.arrayBuffer()),
          filename: f.name,
        })),
      );
      parsed = await parsePdfBatch(buffers);
    } else if (allPdfs) {
      const f = files[0]!;
      const buffer = new Uint8Array(await f.arrayBuffer());
      parsed = await parsePdf(buffer, f.name);
    } else {
      // HTML / CSV: un solo archivo, se procesa como texto.
      const content = await files[0]!.text();
      parsed = parseFile(content);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error parseando el archivo";
    redirectImportError(msg, filename);
  }
  const tParse = Date.now() - tParseStart;

  if (!parsed.name) {
    redirectImportError(
      "El archivo no parece ser un reporte válido.",
      filename,
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
      "El archivo no parece ser un reporte válido.",
      filename,
    );
  }

  const result = await runImport(supabase, user.id, parsed, filename, {
    minShots,
  });

  const tTotal = Date.now() - t0;
  console.log(
    `[import] done file=${filename} parse=${tParse}ms total=${tTotal}ms ` +
      `(${formatDurationHuman(tTotal)})`,
  );

  redirectToResult(result);
}

/**
 * Segundo paso del import de un ranking FAT: el usuario ya completó la
 * fecha (y, si quiso, corrigió el nombre). Reusamos el `ParsedMatch` que
 * quedó guardado en el estado — no hace falta volver a parsear el PDF.
 */
async function confirmFatImport(
  prevState: Extract<ImportFormState, { status: "needsDate" }>,
  formData: FormData,
): Promise<ImportFormState> {
  const date = String(formData.get("date") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!isValidIsoDate(date)) {
    return { ...prevState, error: "Ingresá una fecha válida." };
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
  redirectToResult(result);
}

/** Importa el `ParsedMatch` y loguea la acción. Errores conocidos → redirect. */
async function runImport(
  supabase: TypedSupabaseClient,
  userId: string,
  parsed: ParsedMatch,
  filename: string,
  options: ImportOptions = {},
): Promise<ImportResult> {
  let result: ImportResult;
  try {
    result = await importParsedMatch(supabase, parsed, userId, filename, options);
  } catch (e) {
    if (e instanceof ImportError) {
      redirectImportError(e.message, filename);
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
function redirectImportError(message: string, lastFile: string): never {
  const params = new URLSearchParams({ error: message, lastFile });
  redirect(`/import?${params.toString()}`);
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
function redirectToResult(result: ImportResult): never {
  const params = new URLSearchParams({
    ok: "1",
    matchId: result.matchId,
    name: result.matchName,
    discipline: result.disciplineName,
    entries: String(result.insertedEntries),
    stages: String(result.insertedStages),
    stageResults: String(result.insertedStageResults),
    existed: result.existedAlready ? "1" : "0",
  });
  // Avisos no-fatales del parser (ej. filas descartadas). Van en la URL para
  // que la página los muestre; si no hay, no ensuciamos la query string.
  if (result.warnings?.length) {
    params.set("warnings", result.warnings.join("\n"));
  }
  redirect(`/import?${params.toString()}`);
}

/** Valida una fecha "AAAA-MM-DD" real (formato + rangos de mes/día). */
function isValidIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

function formatDurationHuman(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${s % 60}s`;
}
