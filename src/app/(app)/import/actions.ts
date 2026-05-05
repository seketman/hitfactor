"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parsePractiscoreHtml } from "@/lib/parsers/practiscore";
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
  if (!/\.html?$/i.test(filename)) {
    redirect("/import?error=Solo%20archivos%20HTML%20por%20ahora");
  }

  const html = await file.text();

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const parsed = parsePractiscoreHtml(html);

  if (!parsed.name || !parsed.date) {
    redirect(
      "/import?error=" +
        encodeURIComponent("El archivo no parece ser un reporte de PractiScore válido."),
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
    name: result.matchName,
    entries: String(result.insertedEntries),
    stages: String(result.insertedStages),
    stageResults: String(result.insertedStageResults),
    existed: result.existedAlready ? "1" : "0",
  });
  redirect(`/import?${params.toString()}`);
}
