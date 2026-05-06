"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { redirectWithError } from "@/lib/redirects";

export async function deleteMatch(formData: FormData) {
  const matchId = String(formData.get("match_id") ?? "");
  if (!matchId) return;

  const supabase = await createClient();
  const { error } = await supabase.from("matches").delete().eq("id", matchId);
  if (error) {
    redirectWithError(`/matches/${matchId}`, "No se pudo borrar: " + error.message);
  }
  redirect("/dashboard?info=" + encodeURIComponent("Match eliminado"));
}
