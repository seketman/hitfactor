"use server";

import { getLocale, getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { redirectWithError } from "@/lib/redirects";
import { safeBackPath } from "@/lib/paths";
import { requireUser } from "@/lib/supabase/require-user";
import { AUDIT_ACTION, logAction } from "@/lib/audit/log-action";
import { getProfile } from "@/lib/db/profiles";
import * as matchesDb from "@/lib/db/matches";
import { canDeleteMatch, canEditEntry, canEditMatch } from "@/lib/permissions";
import { isLikelyAbsent } from "@/lib/matches/entry-status";

/**
 * Why every action here checks permissions server-side AND counts
 * affected rows:
 *
 * PostgREST does **not** return an error when RLS filters every row of an
 * UPDATE/DELETE — it returns 200 with an empty body. Reading
 * `error === null` as "it worked" did two bad things at once: it
 * confirmed to the user an operation that never happened, and it wrote to
 * `audit_log` an action the database had refused. An audit log recording
 * intentions instead of facts is worse than none, because it gets read
 * with the confidence of the latter. See issues #196 and #197.
 *
 * The permission check comes first so the user gets an actionable error
 * ("you are not the importer") rather than a generic one. The row count
 * stays as a backstop: if RLS and `canEditMatch` ever disagree, the
 * disagreement surfaces here instead of becoming a false audit entry.
 */

export async function deleteMatch(formData: FormData) {
  const locale = await getLocale();
  const t = await getTranslations("actionError");
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

  // Snapshot before deleting — otherwise we lose the context to audit
  // with. It carries `imported_by_user_id`, so the permission check costs
  // no extra query.
  const matchSnapshot = await matchesDb.getMatchDeleteSnapshot(supabase, matchId);
  if (!matchSnapshot) {
    redirectWithError(`/matches/${matchId}`, t("matchNotFound"), locale);
  }

  const profile = await getProfile(supabase, user.id);
  const allowed = canDeleteMatch({
    userId: user.id,
    isAdmin: profile?.is_admin === true,
    importedByUserId: matchSnapshot.imported_by_user_id,
  });
  if (!allowed) {
    redirectWithError(`/matches/${matchId}`, t("onlyImporterOrAdmin"), locale);
  }

  const { affected, error } = await matchesDb.deleteMatch(supabase, matchId);
  if (error) {
    redirectWithError(
      `/matches/${matchId}`,
      t("deleteFailed", { error }),
      locale,
    );
  }
  // Zero rows with no error = RLS refused it. Don't audit, don't fake
  // success.
  if (affected === 0) {
    redirectWithError(`/matches/${matchId}`, t("onlyImporterOrAdmin"), locale);
  }

  await logAction(supabase, user.id, {
    action: AUDIT_ACTION.MATCH_DELETE,
    entityType: "match",
    entityId: matchId,
    metadata: {
      match_name: matchSnapshot.name,
      match_date: matchSnapshot.date,
      region: matchSnapshot.region,
      discipline_code: matchSnapshot.disciplines?.code,
      discipline_name: matchSnapshot.disciplines?.name,
    },
  });

  // No `?info=`: this redirect targets `/matches` or
  // `/dashboard/{discipline}`, and neither reads that search param (only
  // `/login` does). The confirmation message that used to ride along was
  // never rendered. Confirming a deletion is a separate UX decision, not
  // a string left dangling in the URL.
  redirect({ href: backTo, locale });
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
  const locale = await getLocale();
  const t = await getTranslations("actionError");
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

  // Snapshot beforehand to record before/after, and to check permissions:
  // it carries `imported_by_user_id` for the same reason the delete one
  // does.
  const matchBefore = await matchesDb.getMatchClubSnapshot(supabase, matchId);
  if (!matchBefore) {
    redirectWithError(`/matches/${matchId}`, t("matchNotFound"), locale);
  }

  const profile = await getProfile(supabase, user.id);
  const allowed = canEditMatch({
    userId: user.id,
    isAdmin: profile?.is_admin === true,
    importedByUserId: matchBefore.imported_by_user_id,
  });
  if (!allowed) {
    redirectWithError(`/matches/${matchId}`, t("onlyImporterOrAdmin"), locale);
  }

  const { affected, error } = await matchesDb.updateMatchClub(
    supabase,
    matchId,
    region,
  );

  if (error) {
    redirectWithError(
      `/matches/${matchId}`,
      t("updateClubFailed", { error }),
      locale,
    );
  }
  if (affected === 0) {
    redirectWithError(`/matches/${matchId}`, t("onlyImporterOrAdmin"), locale);
  }

  await logAction(supabase, user.id, {
    action: AUDIT_ACTION.MATCH_UPDATE_CLUB,
    entityType: "match",
    entityId: matchId,
    metadata: {
      match_name: matchBefore.name,
      before: { region: matchBefore.region },
      after: { region },
    },
  });

  revalidatePath(`/matches/${matchId}`);
  revalidatePath("/dashboard");
  redirect({ href: `/matches/${matchId}`, locale });
}

/**
 * Edita el `min_shots` de un match (issue #75). Puede hacerlo:
 *  - El importador del match (cuando se le pasó el dato post-import).
 *  - Cualquier admin (para completar matches viejos importados antes de la
 *    feature). La policy `matches_update_admin` (migración 0014) lo permite.
 *
 * Validamos también en server-side para devolver un error claro cuando el
 * usuario no califica — sino RLS solo devuelve "0 filas actualizadas" sin
 * razón visible.
 *
 * El valor llega como texto desde el form. "" → null (limpia el campo, útil
 * para revertir un valor mal ingresado). Cualquier int positivo → ese int.
 * Otros → error.
 */
export async function updateMatchMinShots(formData: FormData) {
  const locale = await getLocale();
  const t = await getTranslations("actionError");
  const matchId = String(formData.get("match_id") ?? "");
  if (!matchId) return;

  const raw = String(formData.get("min_shots") ?? "").trim();
  let nextValue: number | null;
  if (raw === "") {
    nextValue = null;
  } else {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      redirectWithError(`/matches/${matchId}`, t("minShotsFormat"), locale);
    }
    nextValue = n;
  }

  const { supabase, user } = await requireUser();

  const matchBefore = await matchesDb.getMatchMinShotsSnapshot(supabase, matchId);

  if (!matchBefore) {
    redirectWithError(`/matches/${matchId}`, t("matchNotFound"), locale);
  }

  const profile = await getProfile(supabase, user.id);
  const allowed = canEditMatch({
    userId: user.id,
    isAdmin: profile?.is_admin === true,
    importedByUserId: matchBefore.imported_by_user_id,
  });

  if (!allowed) {
    redirectWithError(`/matches/${matchId}`, t("onlyImporterOrAdmin"), locale);
  }

  const { affected, error } = await matchesDb.updateMatchMinShots(
    supabase,
    matchId,
    nextValue,
  );

  if (error) {
    redirectWithError(
      `/matches/${matchId}`,
      t("updateFailed", { error }),
      locale,
    );
  }
  if (affected === 0) {
    redirectWithError(`/matches/${matchId}`, t("onlyImporterOrAdmin"), locale);
  }

  await logAction(supabase, user.id, {
    action: AUDIT_ACTION.MATCH_UPDATE_MIN_SHOTS,
    entityType: "match",
    entityId: matchId,
    metadata: {
      match_name: matchBefore.name,
      before: { min_shots: matchBefore.min_shots },
      after: { min_shots: nextValue },
    },
  });

  revalidatePath(`/matches/${matchId}`);
  revalidatePath("/dashboard");
  redirect({ href: `/matches/${matchId}`, locale });
}

/**
 * Alterna el flag `is_absent` de un match_entry. La RLS de update se amplió
 * en la migration 0008 para aceptar tres autores:
 *   - importador del match (mismo modelo que las otras ediciones).
 *   - admin del sitio (`profiles.is_admin = true`).
 *   - el tirador mismo (linked_user_id del shooter del entry coincide
 *     con `auth.uid()`).
 *
 * Validamos también en server-side para devolver un error claro si el
 * usuario no encaja en ninguno de los tres (sino la RLS lo mostraría
 * como "0 filas actualizadas" sin razón visible).
 *
 * Todo flip se audita en `audit_log` con before/after, nombre del tirador
 * y nombre del match — importante porque permitir self-edit abre la
 * posibilidad de abuso silencioso (un user borrando un mal resultado
 * propio marcándolo como ausente).
 */
export async function toggleEntryAbsent(formData: FormData) {
  const locale = await getLocale();
  const t = await getTranslations("actionError");
  const matchId = String(formData.get("match_id") ?? "");
  const entryId = String(formData.get("entry_id") ?? "");
  if (!matchId || !entryId) return;

  const { supabase, user } = await requireUser();

  // Snapshot del entry + match + shooter ANTES del cambio. Lo usamos para:
  //   - validar permisos sin segunda query
  //   - alimentar el audit log con before/after
  const entry = await matchesDb.getEntryAbsentSnapshot(supabase, entryId);

  if (!entry || entry.match_id !== matchId) {
    redirectWithError(`/matches/${matchId}`, t("entryNotFound"), locale);
  }

  const profile = await getProfile(supabase, user.id);
  const allowed = canEditEntry({
    userId: user.id,
    isAdmin: profile?.is_admin === true,
    importedByUserId: entry.matches?.imported_by_user_id ?? null,
    isSelf: entry.shooters?.linked_user_id === user.id,
  });

  if (!allowed) {
    redirectWithError(`/matches/${matchId}`, t("noPermissionForEntry"), locale);
  }

  const nextValue = !entry.is_absent;

  // Defense-in-depth: si la entry tiene puntaje o % > 0, el tirador
  // claramente disparó al menos un tiro. Marcar ausencia ahí distorsionaría
  // los stats. La UI ya esconde el botón en ese caso, pero validamos
  // server-side por si alguien arma el POST a mano. La acción inversa
  // (quitar ausente) siempre se permite — útil para corregir un marcado
  // erróneo aunque el entry "ya tenga datos" por cualquier razón.
  if (nextValue === true && !isLikelyAbsent(entry)) {
    redirectWithError(`/matches/${matchId}`, t("cannotMarkAbsent"), locale);
  }

  const { affected, error } = await matchesDb.updateEntryAbsent(
    supabase,
    entryId,
    nextValue,
  );

  if (error) {
    redirectWithError(
      `/matches/${matchId}`,
      t("updateFailed", { error }),
      locale,
    );
  }
  if (affected === 0) {
    redirectWithError(`/matches/${matchId}`, t("noPermissionForEntry"), locale);
  }

  await logAction(supabase, user.id, {
    action: AUDIT_ACTION.ENTRY_UPDATE_ABSENT,
    entityType: "match_entry",
    entityId: entryId,
    metadata: {
      match_id: matchId,
      match_name: entry.matches?.name ?? null,
      shooter_full_name: entry.shooters?.full_name ?? null,
      before: { is_absent: entry.is_absent },
      after: { is_absent: nextValue },
    },
  });

  revalidatePath(`/matches/${matchId}`);
  revalidatePath("/dashboard");
  redirect({ href: `/matches/${matchId}`, locale });
}
