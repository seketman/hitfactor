"use server";

import { getLocale, getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { redirectWithError } from "@/lib/redirects";
import { isInternalAppPath } from "@/lib/paths";
import { requireUser } from "@/lib/supabase/require-user";
import { AUDIT_ACTION, logAction } from "@/lib/audit/log-action";
import * as shootersDb from "@/lib/db/shooters";
import { getMatchName } from "@/lib/db/matches";

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
 *  - `redirect_to` (optional): ruta interna a la que volver después del
 *    claim. Pasa por `isInternalAppPath`: el valor lo controla quien manda el
 *    form, y sin whitelist esto es un open redirect. `redirect` de next-intl
 *    NO alcanza como defensa — cualquier href con esquema (`https:`,
 *    `javascript:`) no es "localizable" para next-intl, así que lo deja pasar
 *    crudo, sin prefijo y sin tocar, directo a `redirect()` de Next.
 *
 * Reglas:
 *  - El shooter no debe estar claimado por **otro** usuario (la query update
 *    con `.is("linked_user_id", null)` lo asegura: si está claimado, no
 *    actualiza ninguna fila).
 *  - Si ya está claimado por este mismo usuario, es un no-op silencioso.
 */
export async function claimShooter(formData: FormData) {
  const locale = await getLocale();
  const t = await getTranslations("actionError");
  const shooterId = String(formData.get("shooter_id") ?? "");
  const matchId = String(formData.get("match_id") ?? "");
  const redirectToRaw = String(formData.get("redirect_to") ?? "");
  if (!shooterId) return;

  const { supabase, user } = await requireUser();
  const userId = user.id;

  // Solo se redirige si el form pidió un destino, igual que antes. La
  // whitelist descarta lo que no sea una ruta interna: sin ella, el valor lo
  // elige quien manda el form.
  const redirectTo = isInternalAppPath(redirectToRaw) ? redirectToRaw : null;

  const shooter = await shootersDb.getShooterClaimState(supabase, shooterId);

  // Ya es mío: no-op, redirigimos como si todo bien.
  if (shooter && shooter.linked_user_id === userId) {
    if (matchId) revalidatePath(`/matches/${matchId}`);
    revalidatePath("/dashboard");
    if (redirectTo) redirect({ href: redirectTo, locale });
    return;
  }

  const errorTarget =
    redirectTo ?? (matchId ? `/matches/${matchId}` : "/dashboard");

  // Linkeado a otro usuario: error.
  if (shooter && shooter.linked_user_id && shooter.linked_user_id !== userId) {
    redirectWithError(errorTarget, t("shooterClaimedByOther"), locale);
  }

  const { error } = await shootersDb.claimShooter(supabase, shooterId, userId);

  if (error) {
    redirectWithError(
      errorTarget,
      t("claimFailed"),
      locale,
      { context: "shooter.claim", detail: error },
    );
  }

  // Si vino con match_id resolvemos también el nombre del match para que
  // la línea del audit log diga "desde 'Social 4 - 19/04/26'".
  let matchName: string | undefined;
  if (matchId) {
    const m = await getMatchName(supabase, matchId);
    matchName = m?.name;
  }

  await logAction(supabase, userId, {
    action: AUDIT_ACTION.SHOOTER_CLAIM,
    entityType: "shooter",
    entityId: shooterId,
    metadata: {
      shooter_full_name: shooter?.full_name,
      match_id: matchId || undefined,
      match_name: matchName,
    },
  });

  if (matchId) revalidatePath(`/matches/${matchId}`);
  revalidatePath("/dashboard");

  if (redirectTo) {
    redirect({ href: redirectTo, locale });
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
  const shooter = await shootersDb.getMyShooterName(supabase, shooterId, user.id);

  const { affected } = await shootersDb.unclaimShooter(
    supabase,
    shooterId,
    user.id,
  );

  // Solo logueamos si el update afectó alguna fila — sino podríamos loggear
  // intentos que no hicieron nada (ej. doble submit, shooter ajeno).
  if (affected > 0) {
    await logAction(supabase, user.id, {
      action: AUDIT_ACTION.SHOOTER_UNCLAIM,
      entityType: "shooter",
      entityId: shooterId,
      metadata: {
        shooter_full_name: shooter?.full_name,
      },
    });
  }

  if (matchId) revalidatePath(`/matches/${matchId}`);
  revalidatePath("/dashboard");
}
