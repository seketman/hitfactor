"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Acción de claim de un shooter: el usuario logueado declara
 * "este shooter soy yo".
 *
 * Soporta **múltiples identidades**: un mismo usuario puede claimar varios
 * shooters (uno por disciplina/torneo) porque el nombre escrito en cada
 * planilla varía ("Apellido, Nombre" vs "Apellido Nombre", iniciales, etc.).
 *
 * Inputs (FormData):
 *  - `shooter_id` (required): UUID del shooter a linkear.
 *  - `match_id` (optional): para revalidar la página del match si vino de ahí.
 *  - `redirect_to` (optional): URL a la que volver después del claim.
 *
 * Reglas:
 *  - El shooter no debe estar claimado por **otro** usuario (la query update
 *    con `.is("linked_user_id", null)` lo asegura: si está claimado, no
 *    actualiza ninguna fila).
 *  - Si ya está claimado por este mismo usuario, es un no-op silencioso.
 */
export async function claimShooter(formData: FormData) {
  const shooterId = String(formData.get("shooter_id") ?? "");
  const matchId = String(formData.get("match_id") ?? "");
  const redirectTo = String(formData.get("redirect_to") ?? "");
  if (!shooterId) return;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");
  const userId = userData.user.id;

  const { data: shooter } = await supabase
    .from("shooters")
    .select("id, linked_user_id")
    .eq("id", shooterId)
    .maybeSingle();

  // Ya es mío: no-op, redirigimos como si todo bien.
  if (shooter && shooter.linked_user_id === userId) {
    if (matchId) revalidatePath(`/matches/${matchId}`);
    revalidatePath("/dashboard");
    if (redirectTo) redirect(redirectTo);
    return;
  }

  // Linkeado a otro usuario: error.
  if (shooter && shooter.linked_user_id && shooter.linked_user_id !== userId) {
    const errorTarget = redirectTo || (matchId ? `/matches/${matchId}` : "/dashboard");
    redirect(
      `${errorTarget}?error=${encodeURIComponent(
        "Este tirador ya fue claimado por otro usuario.",
      )}`,
    );
  }

  const { error } = await supabase
    .from("shooters")
    .update({ linked_user_id: userId })
    .eq("id", shooterId)
    .is("linked_user_id", null);

  if (error) {
    const errorTarget = redirectTo || (matchId ? `/matches/${matchId}` : "/dashboard");
    redirect(
      `${errorTarget}?error=${encodeURIComponent(
        "No se pudo linkear el tirador: " + error.message,
      )}`,
    );
  }

  if (matchId) revalidatePath(`/matches/${matchId}`);
  revalidatePath("/dashboard");

  if (redirectTo) {
    redirect(redirectTo);
  }
}

/**
 * Desvincula un shooter del usuario logueado. Requiere `shooter_id` —
 * desvincula solo esa identidad, no todas las del usuario.
 */
export async function unclaimShooter(formData: FormData) {
  const shooterId = String(formData.get("shooter_id") ?? "");
  const matchId = String(formData.get("match_id") ?? "");
  if (!shooterId) return;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  await supabase
    .from("shooters")
    .update({ linked_user_id: null })
    .eq("id", shooterId)
    .eq("linked_user_id", userData.user.id);

  if (matchId) revalidatePath(`/matches/${matchId}`);
  revalidatePath("/dashboard");
}
