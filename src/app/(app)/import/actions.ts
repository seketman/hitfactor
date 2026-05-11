"use server";

import { redirect } from "next/navigation";
import { parseFile, parsePdf } from "@/lib/parsers";
import type { ParsedMatch } from "@/lib/types/match";
import { redirectWithError } from "@/lib/redirects";
import { requireUser } from "@/lib/supabase/require-user";
import { AUDIT_ACTION, logAction } from "@/lib/audit/log-action";
import {
  importParsedMatch,
  ImportError,
  type ImportResult,
} from "@/lib/import/import-match";

export async function importHtml(formData: FormData) {
  // Instrumentación de tiempos: queremos saber dónde se va el tiempo
  // (parser vs DB) y poder estimar futuros imports. Loguea al final un
  // resumen tipo "[import] file=X parse=Yms import=Zms total=Wms" más
  // el timestamp de inicio en ISO para correlacionar con logs externos.
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

  console.log(
    `[import] start ${startedAt.toISOString()} file=${filename} size=${file.size}b`,
  );

  const { supabase, user } = await requireUser();

  // PDFs van como binario; HTML/CSV como texto. Cada rama llama a su
  // parser: parsePdf es async (carga pdf-parse dinámicamente), parseFile
  // es sync.
  let parsed: ParsedMatch;
  const tParseStart = Date.now();
  try {
    if (isPdf) {
      const buffer = new Uint8Array(await file.arrayBuffer());
      parsed = await parsePdf(buffer);
    } else {
      const content = await file.text();
      parsed = parseFile(content);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error parseando el archivo";
    redirectWithError("/import", msg);
  }
  const tParse = Date.now() - tParseStart;

  if (!parsed.name || !parsed.date) {
    redirectWithError("/import", "El archivo no parece ser un reporte válido.");
  }

  let result: ImportResult;
  const tImportStart = Date.now();
  try {
    result = await importParsedMatch(supabase, parsed, user.id, filename);
  } catch (e) {
    if (e instanceof ImportError) {
      redirectWithError("/import", e.message);
    }
    throw e;
  }
  const tImport = Date.now() - tImportStart;

  const tTotal = Date.now() - t0;
  console.log(
    `[import] done file=${filename} parse=${tParse}ms import=${tImport}ms ` +
      `total=${tTotal}ms (${formatDurationHuman(tTotal)})`,
  );

  await logAction(supabase, user.id, {
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

function formatDurationHuman(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${s % 60}s`;
}
