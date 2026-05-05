"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Acción de claim de un shooter: el usuario logueado declara
 * "este shooter soy yo".
 *
 * Inputs (FormData):
 *  - `shooter_id` (required): UUID del shooter a linkear.
 *  - `match_id` (optional): para revalidar la página del match si vino de ahí.
 *  - `redirect_to` (optional): URL a la que volver después del claim.
 *      Default: la página actual (revalidate-only).
 *
 * Reglas:
 *  - El usuario no puede tener ya otro shooter linkeado.
 *  - El shooter no debe estar claimado por otro user (RLS lo asegura).
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

  // El usuario no puede claimar 2 shooters
  const { data: existing } = await supabase
    .from("shooters")
    .select("id")
    .eq("linked_user_id", userId)
    .maybeSingle();

  if (existing && existing.id !== shooterId) {
    const errorTarget = redirectTo || (matchId ? `/matches/${matchId}` : "/dashboard");
    redirect(
      `${errorTarget}?error=${encodeURIComponent(
        "Ya tenés otro tirador linkeado. Quitá ese link primero desde tu perfil.",
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

export async function unclaimShooter(formData: FormData) {
  const matchId = String(formData.get("match_id") ?? "");

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  await supabase
    .from("shooters")
    .update({ linked_user_id: null })
    .eq("linked_user_id", userData.user.id);

  if (matchId) revalidatePath(`/matches/${matchId}`);
  revalidatePath("/dashboard");
}
