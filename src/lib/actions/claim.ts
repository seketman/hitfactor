"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { redirectWithError } from "@/lib/redirects";
import { requireUser } from "@/lib/supabase/require-user";
import { AUDIT_ACTION, logAction } from "@/lib/audit/log-action";

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

  const { supabase, user } = await requireUser();
  const userId = user.id;

  const { data: shooter } = await supabase
    .from("shooters")
    .select("id, full_name, linked_user_id")
    .eq("id", shooterId)
    .maybeSingle();

  // Ya es mío: no-op, redirigimos como si todo bien.
  if (shooter && shooter.linked_user_id === userId) {
    if (matchId) revalidatePath(`/matches/${matchId}`);
    revalidatePath("/dashboard");
    if (redirectTo) redirect(redirectTo);
    return;
  }

  const errorTarget = redirectTo || (matchId ? `/matches/${matchId}` : "/dashboard");

  // Linkeado a otro usuario: error.
  if (shooter && shooter.linked_user_id && shooter.linked_user_id !== userId) {
    redirectWithError(errorTarget, "Este tirador ya fue claimado por otro usuario.");
  }

  const { error } = await supabase
    .from("shooters")
    .update({ linked_user_id: userId })
    .eq("id", shooterId)
    .is("linked_user_id", null);

  if (error) {
    redirectWithError(
      errorTarget,
      "No se pudo asociar el tirador a tu cuenta: " + error.message,
    );
  }

  // Si vino con match_id resolvemos también el nombre del match para que
  // la línea del audit log diga "desde 'Social 4 - 19/04/26'".
  let matchName: string | undefined;
  if (matchId) {
    const { data: m } = await supabase
      .from("matches")
      .select("name")
      .eq("id", matchId)
      .maybeSingle();
    matchName = (m as { name?: string } | null)?.name;
  }

  await logAction(supabase, userId, {
    action: AUDIT_ACTION.SHOOTER_CLAIM,
    entityType: "shooter",
    entityId: shooterId,
    metadata: {
      shooter_full_name: (shooter as { full_name?: string } | null)?.full_name,
      match_id: matchId || undefined,
      match_name: matchName,
    },
  });

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

  const { supabase, user } = await requireUser();

  // Snapshot del nombre antes de desvincular.
  const { data: shooter } = await supabase
    .from("shooters")
    .select("full_name")
    .eq("id", shooterId)
    .eq("linked_user_id", user.id)
    .maybeSingle();

  const { data: updated } = await supabase
    .from("shooters")
    .update({ linked_user_id: null })
    .eq("id", shooterId)
    .eq("linked_user_id", user.id)
    .select("id");

  // Solo logueamos si el update afectó alguna fila — sino podríamos loggear
  // intentos que no hicieron nada (ej. doble submit, shooter ajeno).
  if (Array.isArray(updated) && updated.length > 0) {
    await logAction(supabase, user.id, {
      action: AUDIT_ACTION.SHOOTER_UNCLAIM,
      entityType: "shooter",
      entityId: shooterId,
      metadata: {
        shooter_full_name: (shooter as { full_name?: string } | null)?.full_name,
      },
    });
  }

  if (matchId) revalidatePath(`/matches/${matchId}`);
  revalidatePath("/dashboard");
}
