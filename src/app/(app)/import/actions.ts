"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseFile } from "@/lib/parsers";
import { redirectWithError } from "@/lib/redirects";
import { AUDIT_ACTION, logAction } from "@/lib/audit/log-action";
import {
  importParsedMatch,
  ImportError,
  type ImportResult,
} from "@/lib/import/import-match";

export async function importHtml(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirectWithError("/import", "Elegí un archivo");
  }

  const filename = file.name;
  if (!/\.(html?|csv)$/i.test(filename)) {
    redirectWithError("/import", "Solo se aceptan archivos HTML o CSV");
  }

  const content = await file.text();

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const parsed = parseFile(content);

  if (!parsed.name || !parsed.date) {
    redirectWithError("/import", "El archivo no parece ser un reporte válido.");
  }

  let result: ImportResult;
  try {
    result = await importParsedMatch(supabase, parsed, userData.user.id, filename);
  } catch (e) {
    if (e instanceof ImportError) {
      redirectWithError("/import", e.message);
    }
    throw e;
  }

  await logAction(supabase, userData.user.id, {
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
