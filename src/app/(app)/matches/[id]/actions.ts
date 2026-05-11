"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { redirectWithError, safeBackPath } from "@/lib/redirects";
import { requireUser } from "@/lib/supabase/require-user";
import { AUDIT_ACTION, logAction } from "@/lib/audit/log-action";

export async function deleteMatch(formData: FormData) {
  const matchId = String(formData.get("match_id") ?? "");
  if (!matchId) return;
  // Ruta a la que volver al terminar — viene del form de la página actual
  // (típico "/matches" o "/dashboard/{disciplina}"). Si no se pasa o es
  // inválida, caemos a /matches (la grilla principal de matches).
  const from = formData.get("from");
  const backTo = safeBackPath(
    typeof from === "string" ? from : null,
    "/matches",
  );

  const { supabase, user } = await requireUser();

  // Snapshot antes de borrar — sino perdemos el contexto para auditar.
  const { data: matchSnapshot } = await supabase
    .from("matches")
    .select("name, date, region, disciplines(code, name)")
    .eq("id", matchId)
    .maybeSingle();

  const { error } = await supabase.from("matches").delete().eq("id", matchId);
  if (error) {
    redirectWithError(`/matches/${matchId}`, "No se pudo borrar: " + error.message);
  }

  if (matchSnapshot) {
    type Snapshot = {
      name: string;
      date: string;
      region: string | null;
      disciplines: { code: string; name: string } | null;
    };
    const snap = matchSnapshot as unknown as Snapshot;
    await logAction(supabase, user.id, {
      action: AUDIT_ACTION.MATCH_DELETE,
      entityType: "match",
      entityId: matchId,
      metadata: {
        match_name: snap.name,
        match_date: snap.date,
        region: snap.region,
        discipline_code: snap.disciplines?.code,
        discipline_name: snap.disciplines?.name,
      },
    });
  }

  redirect(`${backTo}?info=${encodeURIComponent("Match eliminado")}`);
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

  const { supabase, user } = await requireUser();

  // Snapshot antes para registrar before/after.
  const { data: matchBefore } = await supabase
    .from("matches")
    .select("name, region")
    .eq("id", matchId)
    .maybeSingle();

  const { error } = await supabase
    .from("matches")
    .update({ region })
    .eq("id", matchId)
    .eq("imported_by_user_id", user.id);

  if (error) {
    redirectWithError(`/matches/${matchId}`, "No se pudo actualizar el club: " + error.message);
  }

  if (matchBefore) {
    const snap = matchBefore as unknown as { name: string; region: string | null };
    await logAction(supabase, user.id, {
      action: AUDIT_ACTION.MATCH_UPDATE_CLUB,
      entityType: "match",
      entityId: matchId,
      metadata: {
        match_name: snap.name,
        before: { region: snap.region },
        after: { region },
      },
    });
  }

  revalidatePath(`/matches/${matchId}`);
  revalidatePath("/dashboard");
  redirect(`/matches/${matchId}`);
}
