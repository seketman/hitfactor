"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function deleteMatch(formData: FormData) {
  const matchId = String(formData.get("match_id") ?? "");
  if (!matchId) return;

  const supabase = await createClient();
  const { error } = await supabase.from("matches").delete().eq("id", matchId);
  if (error) {
    redirect(
      `/matches/${matchId}?error=${encodeURIComponent("No se pudo borrar: " + error.message)}`,
    );
  }
  redirect("/dashboard?info=" + encodeURIComponent("Match eliminado"));
}
