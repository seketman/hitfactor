"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseFile } from "@/lib/parsers";
import {
  importParsedMatch,
  ImportError,
  type ImportResult,
} from "@/lib/import/import-match";

export async function importHtml(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect("/import?error=Eleg%C3%AD%20un%20archivo");
  }

  const filename = file.name;
  if (!/\.(html?|csv)$/i.test(filename)) {
    redirect("/import?error=Solo%20se%20aceptan%20archivos%20HTML%20o%20CSV");
  }

  const content = await file.text();

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const parsed = parseFile(content);

  if (!parsed.name || !parsed.date) {
    redirect(
      "/import?error=" +
        encodeURIComponent("El archivo no parece ser un reporte válido."),
    );
  }

  let result: ImportResult;
  try {
    result = await importParsedMatch(supabase, parsed, userData.user.id, filename);
  } catch (e) {
    if (e instanceof ImportError) {
      redirect(`/import?error=${encodeURIComponent(e.message)}`);
    }
    throw e;
  }

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
