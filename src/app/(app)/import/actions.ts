"use server";

import { redirect } from "next/navigation";
import { parseFile, parsePdf } from "@/lib/parsers";
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

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirectWithError("/import", "Elegí un archivo");
  }

  const filename = file.name;
  const isPdf = /\.pdf$/i.test(filename);
  const isText = /\.(html?|csv)$/i.test(filename);
  if (!isPdf && !isText) {
    redirectWithError("/import", "Solo se aceptan archivos HTML, CSV o PDF");
  }

  // `min_shots`: opcional en el form. Si está vacío o no parsea como int
  // positivo, queda null (el importer aplica 45 si es FBI; resto queda null).
  const minShots = parseMinShotsField(formData.get("min_shots"));

  console.log(
    `[import] start ${startedAt.toISOString()} file=${filename} size=${file.size}b`,
  );

  const { supabase, user } = await requireUser();

  // PDFs van como binario; HTML/CSV como texto.
  let parsed: ParsedMatch;
  const tParseStart = Date.now();
  try {
    if (isPdf) {
      const buffer = new Uint8Array(await file.arrayBuffer());
      parsed = await parsePdf(buffer, filename);
    } else {
      const content = await file.text();
      parsed = parseFile(content);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error parseando el archivo";
    redirectWithError("/import", msg);
  }
  const tParse = Date.now() - tParseStart;

  if (!parsed.name) {
    redirectWithError("/import", "El archivo no parece ser un reporte válido.");
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
    redirectWithError("/import", "El archivo no parece ser un reporte válido.");
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
      redirectWithError("/import", e.message);
    }
    throw e;
  }
  await logImport(supabase, userId, result);
  return result;
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
