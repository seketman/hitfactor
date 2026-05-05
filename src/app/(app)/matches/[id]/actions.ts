"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Claim de un shooter: el usuario logueado declara "este shooter soy yo".
 * Solo se permite si:
 *  - El shooter aún no tiene linked_user_id (RLS lo asegura)
 *  - El usuario no tiene ya otro shooter linkeado (lo chequeamos acá)
 */
export async function claimShooter(formData: FormData) {
  const shooterId = String(formData.get("shooter_id") ?? "");
  const matchId = String(formData.get("match_id") ?? "");
  if (!shooterId) return;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");
  const userId = userData.user.id;

  // Chequeo: no tener ya otro shooter
  const { data: existing } = await supabase
    .from("shooters")
    .select("id")
    .eq("linked_user_id", userId)
    .maybeSingle();

  if (existing && existing.id !== shooterId) {
    redirect(
      `/matches/${matchId}?error=${encodeURIComponent(
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
    redirect(
      `/matches/${matchId}?error=${encodeURIComponent(
        "No se pudo linkear el tirador: " + error.message,
      )}`,
    );
  }

  revalidatePath(`/matches/${matchId}`);
  revalidatePath("/dashboard");
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

  revalidatePath(`/matches/${matchId}`);
  revalidatePath("/dashboard");
}

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
