"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { redirectWithError, safeBackPath } from "@/lib/redirects";
import { requireUser } from "@/lib/supabase/require-user";
import { AUDIT_ACTION, logAction } from "@/lib/audit/log-action";
import { getProfile } from "@/lib/db/profiles";
import { canEditEntry, canEditMatch } from "@/lib/permissions";
import { isLikelyAbsent } from "@/lib/matches/entry-status";

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
  }

  revalidatePath(`/matches/${matchId}`);
  revalidatePath("/dashboard");
  redirect(`/matches/${matchId}`);
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
  const matchId = String(formData.get("match_id") ?? "");
  if (!matchId) return;

  const raw = String(formData.get("min_shots") ?? "").trim();
  let nextValue: number | null;
  if (raw === "") {
    nextValue = null;
  } else {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      redirectWithError(
        `/matches/${matchId}`,
        "Ingresá un número entero positivo o vacío para limpiar",
      );
    }
    nextValue = n;
  }

  const { supabase, user } = await requireUser();

  const { data: matchBefore } = await supabase
    .from("matches")
    .select("name, min_shots, imported_by_user_id")
    .eq("id", matchId)
    .maybeSingle();

  if (!matchBefore) {
    redirectWithError(`/matches/${matchId}`, "Match no encontrado");
  }

  const profile = await getProfile(supabase, user.id);
  const allowed = canEditMatch({
    userId: user.id,
    isAdmin: profile?.is_admin === true,
    importedByUserId: matchBefore.imported_by_user_id,
  });

  if (!allowed) {
    redirectWithError(
      `/matches/${matchId}`,
      "Solo el importador o un admin pueden editar el mínimo de disparos",
    );
  }

  const { error } = await supabase
    .from("matches")
    .update({ min_shots: nextValue })
    .eq("id", matchId);

  if (error) {
    redirectWithError(
      `/matches/${matchId}`,
      "No se pudo actualizar: " + error.message,
    );
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
  redirect(`/matches/${matchId}`);
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
  const matchId = String(formData.get("match_id") ?? "");
  const entryId = String(formData.get("entry_id") ?? "");
  if (!matchId || !entryId) return;

  const { supabase, user } = await requireUser();

  // Snapshot del entry + match + shooter ANTES del cambio. Lo usamos para:
  //   - validar permisos sin segunda query
  //   - alimentar el audit log con before/after
  const { data: entry } = await supabase
    .from("match_entries")
    .select(
      "id, match_id, shooter_id, is_absent, match_points, match_percentage, shooters(linked_user_id, full_name), matches(name, imported_by_user_id)",
    )
    .eq("id", entryId)
    .maybeSingle();

  if (!entry || entry.match_id !== matchId) {
    redirectWithError(`/matches/${matchId}`, "Entry no encontrada");
  }

  const profile = await getProfile(supabase, user.id);
  const allowed = canEditEntry({
    userId: user.id,
    isAdmin: profile?.is_admin === true,
    importedByUserId: entry.matches?.imported_by_user_id ?? null,
    isSelf: entry.shooters?.linked_user_id === user.id,
  });

  if (!allowed) {
    redirectWithError(
      `/matches/${matchId}`,
      "No tenés permiso para cambiar este resultado",
    );
  }

  const nextValue = !entry.is_absent;

  // Defense-in-depth: si la entry tiene puntaje o % > 0, el tirador
  // claramente disparó al menos un tiro. Marcar ausencia ahí distorsionaría
  // los stats. La UI ya esconde el botón en ese caso, pero validamos
  // server-side por si alguien arma el POST a mano. La acción inversa
  // (quitar ausente) siempre se permite — útil para corregir un marcado
  // erróneo aunque el entry "ya tenga datos" por cualquier razón.
  if (nextValue === true && !isLikelyAbsent(entry)) {
    redirectWithError(
      `/matches/${matchId}`,
      "No se puede marcar ausente: el entry tiene puntaje o porcentaje > 0",
    );
  }

  const { error } = await supabase
    .from("match_entries")
    .update({ is_absent: nextValue })
    .eq("id", entryId);

  if (error) {
    redirectWithError(
      `/matches/${matchId}`,
      "No se pudo actualizar: " + error.message,
    );
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
  redirect(`/matches/${matchId}`);
}
