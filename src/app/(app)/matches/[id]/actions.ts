"use server";

import { revalidatePath } from "next/cache";
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

/**
 * Edita el club asociado a un match. Solo lo puede hacer el importador
 * (RLS lo enforce: el UPDATE no afecta filas de otros).
 *
 * Inputs:
 *  - `match_id` (required)
 *  - `club_code` — code del catálogo (ej "TFALP") o "OTHER" si el usuario eligió free-text.
 *  - `country`   — code de país (ej "ARG"), opcional cuando viene del catálogo.
 *  - `custom`    — el texto libre cuando `club_code === "OTHER"`.
 *
 * Se guarda en `matches.region`:
 *  - Catálogo + country: "ARG-TFALP"
 *  - Catálogo sin country: "TFALP"
 *  - Free text: el texto tal cual (parseRegion lo trata como código sin nombre conocido).
 *  - Vacío: NULL (= "no especificado").
 */
export async function updateMatchClub(formData: FormData) {
  const matchId = String(formData.get("match_id") ?? "");
  if (!matchId) return;

  const clubCode = String(formData.get("club_code") ?? "").trim();
  const country = String(formData.get("country") ?? "").trim();
  const custom = String(formData.get("custom") ?? "").trim();

  let region: string | null = null;
  if (clubCode === "OTHER") {
    region = custom || null;
  } else if (clubCode) {
    region = country ? `${country}-${clubCode}` : clubCode;
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const { error } = await supabase
    .from("matches")
    .update({ region })
    .eq("id", matchId)
    .eq("imported_by_user_id", userData.user.id);

  if (error) {
    redirectWithError(`/matches/${matchId}`, "No se pudo actualizar el club: " + error.message);
  }

  revalidatePath(`/matches/${matchId}`);
  revalidatePath("/dashboard");
  redirect(`/matches/${matchId}`);
}
