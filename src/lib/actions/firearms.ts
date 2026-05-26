"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { redirectWithError } from "@/lib/redirects";
import { requireUser } from "@/lib/supabase/require-user";
import { AUDIT_ACTION, logAction } from "@/lib/audit/log-action";

/**
 * Acciones para administrar el catálogo de armas del usuario y el log
 * de uso por match. RLS valida ownership; acá solo formateamos el payload
 * y manejamos redirects.
 */

function trimOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Revalida los paths que dependen del catálogo de armas. Si se pasa `id`,
 * también revalida la página de detalle. Centralizado para no olvidar uno
 * cuando se agrega una vista nueva que liste/use firearms.
 */
function revalidateFirearmPaths(id?: string) {
  revalidatePath("/firearms");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/firearms/${id}`);
}

export async function createFirearm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    redirectWithError("/firearms", "Falta el nombre");
  }

  const { supabase, user } = await requireUser();

  const payload = {
    owner_user_id: user.id,
    name,
    brand: trimOrNull(formData.get("brand")),
    model: trimOrNull(formData.get("model")),
    caliber: trimOrNull(formData.get("caliber")),
    notes: trimOrNull(formData.get("notes")),
  };
  const { data: created, error } = await supabase
    .from("firearms")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    redirectWithError("/firearms", error.message);
  }

  await logAction(supabase, user.id, {
    action: AUDIT_ACTION.FIREARM_CREATE,
    entityType: "firearm",
    entityId: created?.id,
    metadata: {
      name: payload.name,
      brand: payload.brand,
      model: payload.model,
      caliber: payload.caliber,
    },
  });

  revalidateFirearmPaths();
  redirect("/firearms");
}

export async function updateFirearm(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) {
    redirectWithError("/firearms", "Datos incompletos");
  }

  const { supabase, user } = await requireUser();

  // Snapshot antes del update para registrar before/after.
  const { data: before } = await supabase
    .from("firearms")
    .select("name, brand, model, caliber, notes")
    .eq("id", id)
    .maybeSingle();

  const after = {
    name,
    brand: trimOrNull(formData.get("brand")),
    model: trimOrNull(formData.get("model")),
    caliber: trimOrNull(formData.get("caliber")),
    notes: trimOrNull(formData.get("notes")),
  };

  const { error } = await supabase.from("firearms").update(after).eq("id", id);

  if (error) {
    redirectWithError("/firearms", error.message);
  }

  await logAction(supabase, user.id, {
    action: AUDIT_ACTION.FIREARM_UPDATE,
    entityType: "firearm",
    entityId: id,
    metadata: {
      name: after.name,
      before: before ?? undefined,
      after,
    },
  });

  revalidateFirearmPaths(id);
  redirect("/firearms");
}

export async function deleteFirearm(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { supabase, user } = await requireUser();

  // Snapshot antes de borrar.
  const { data: snapshot } = await supabase
    .from("firearms")
    .select("name, brand, model, caliber")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("firearms").delete().eq("id", id);
  if (error) {
    redirectWithError("/firearms", error.message);
  }

  if (snapshot) {
    await logAction(supabase, user.id, {
      action: AUDIT_ACTION.FIREARM_DELETE,
      entityType: "firearm",
      entityId: id,
      metadata: {
        name: snapshot.name,
        brand: snapshot.brand,
        model: snapshot.model,
        caliber: snapshot.caliber,
      },
    });
  }

  revalidateFirearmPaths();
  redirect("/firearms");
}

/**
 * Registra una sesión de uso del arma fuera de torneos (entrenamiento /
 * práctica). Requiere fecha + tiros > 0. Tipo de munición opcional.
 * Audita siempre — el desgaste manual es input del tirador y querés
 * trazabilidad si después sale un número raro.
 */
export async function createFirearmUsage(formData: FormData) {
  const firearmId = String(formData.get("firearm_id") ?? "");
  const usedOn = String(formData.get("used_on") ?? "").trim();
  const roundsRaw = String(formData.get("rounds_fired") ?? "");
  const ammoIdRaw = String(formData.get("ammunition_type_id") ?? "");
  const notes = trimOrNull(formData.get("notes"));

  const errorTarget = firearmId ? `/firearms/${firearmId}` : "/firearms";

  if (!firearmId) {
    redirectWithError("/firearms", "Arma no especificada");
  }
  if (!usedOn) {
    redirectWithError(errorTarget, "Falta la fecha");
  }
  const rounds = Number.parseInt(roundsRaw, 10);
  if (!Number.isFinite(rounds) || rounds <= 0) {
    redirectWithError(
      errorTarget,
      "Tiros disparados debe ser mayor que cero",
    );
  }

  const { supabase, user } = await requireUser();

  const payload = {
    firearm_id: firearmId,
    used_on: usedOn,
    rounds_fired: rounds,
    ammunition_type_id: ammoIdRaw === "" ? null : ammoIdRaw,
    notes,
  };

  const { data: created, error } = await supabase
    .from("firearm_usage_log")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    redirectWithError(errorTarget, error.message);
  }

  // Resolvemos nombres de arma + munición para alimentar el audit log
  // con algo legible — sino la pantalla `/activity` queda con solo IDs.
  const [{ data: firearmRow }, { data: ammoRow }] = await Promise.all([
    supabase
      .from("firearms")
      .select("name")
      .eq("id", firearmId)
      .maybeSingle(),
    payload.ammunition_type_id
      ? supabase
          .from("ammunition_types")
          .select("name")
          .eq("id", payload.ammunition_type_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  await logAction(supabase, user.id, {
    action: AUDIT_ACTION.FIREARM_USAGE_CREATE,
    entityType: "firearm_usage",
    entityId: created?.id,
    metadata: {
      firearm_id: firearmId,
      firearm_name: firearmRow?.name ?? null,
      used_on: usedOn,
      rounds_fired: rounds,
      ammunition_name: ammoRow?.name ?? null,
    },
  });

  revalidateFirearmPaths(firearmId);
  redirect(`/firearms/${firearmId}`);
}

export async function deleteFirearmUsage(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const firearmId = String(formData.get("firearm_id") ?? "");
  if (!id || !firearmId) return;

  const { supabase, user } = await requireUser();

  const { data: snapshot } = await supabase
    .from("firearm_usage_log")
    .select(
      "used_on, rounds_fired, firearms(name), ammunition_types(name)",
    )
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("firearm_usage_log")
    .delete()
    .eq("id", id);

  if (error) {
    redirectWithError(`/firearms/${firearmId}`, error.message);
  }

  if (snapshot) {
    await logAction(supabase, user.id, {
      action: AUDIT_ACTION.FIREARM_USAGE_DELETE,
      entityType: "firearm_usage",
      entityId: id,
      metadata: {
        firearm_id: firearmId,
        firearm_name: snapshot.firearms?.name ?? null,
        used_on: snapshot.used_on,
        rounds_fired: snapshot.rounds_fired,
        ammunition_name: snapshot.ammunition_types?.name ?? null,
      },
    });
  }

  revalidateFirearmPaths(firearmId);
  redirect(`/firearms/${firearmId}`);
}

/**
 * Asigna un arma a un match_entry y registra la cantidad de tiros.
 * Si `firearm_id` viene vacío, borra el log existente (i.e. "no recuerdo / no aplica").
 */
export async function setMatchFirearm(formData: FormData) {
  const matchEntryId = String(formData.get("match_entry_id") ?? "");
  const matchId = String(formData.get("match_id") ?? "");
  const firearmId = String(formData.get("firearm_id") ?? "");
  const roundsRaw = String(formData.get("rounds_fired") ?? "");
  // Munición opcional: si viene vacío, queda NULL (mantiene compat con
  // logs viejos que no tenían esta columna).
  const ammoIdRaw = String(formData.get("ammunition_type_id") ?? "");
  const ammunitionTypeId = ammoIdRaw === "" ? null : ammoIdRaw;

  if (!matchEntryId) return;

  const { supabase, user } = await requireUser();

  const errorTarget = matchId ? `/matches/${matchId}/me` : "/dashboard";

  // Snapshot del log actual + nombres de match/firearm para el audit log.
  // Hacemos las queries en paralelo, son chicas.
  const [logRes, matchNameRes] = await Promise.all([
    supabase
      .from("match_firearm_log")
      .select(
        "firearm_id, rounds_fired, ammunition_type_id, firearms(name), ammunition_types(name)",
      )
      .eq("match_entry_id", matchEntryId)
      .maybeSingle(),
    matchId
      ? supabase
          .from("matches")
          .select("name")
          .eq("id", matchId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const logBefore = logRes.data;
  const matchName = matchNameRes.data?.name;

  if (!firearmId) {
    // Limpiar el log para este match_entry
    const { error } = await supabase
      .from("match_firearm_log")
      .delete()
      .eq("match_entry_id", matchEntryId);
    if (error) {
      redirectWithError(errorTarget, error.message);
    }

    // Solo loguear si efectivamente había un log antes.
    if (logBefore) {
      await logAction(supabase, user.id, {
        action: AUDIT_ACTION.MATCH_FIREARM_CLEAR,
        entityType: "match_entry",
        entityId: matchEntryId,
        metadata: {
          match_id: matchId || undefined,
          match_name: matchName,
          before: {
            firearm_id: logBefore.firearm_id,
            firearm_name: logBefore.firearms?.name,
            rounds_fired: logBefore.rounds_fired,
          },
        },
      });
    }
  } else {
    const rounds = Number.parseInt(roundsRaw, 10);
    if (!Number.isFinite(rounds) || rounds < 0) {
      redirectWithError(errorTarget, "Tiros disparados inválido");
    }

    const { error } = await supabase.from("match_firearm_log").upsert(
      {
        match_entry_id: matchEntryId,
        firearm_id: firearmId,
        rounds_fired: rounds,
        ammunition_type_id: ammunitionTypeId,
        notes: trimOrNull(formData.get("notes")),
      },
      { onConflict: "match_entry_id" },
    );
    if (error) {
      redirectWithError(errorTarget, error.message);
    }

    // Resolver nombres para el audit metadata. Si no hay ammo, evitamos
    // la query — la mayoría de los logs no van a tener munición asignada.
    const [{ data: firearmRow }, { data: ammoRow }] = await Promise.all([
      supabase.from("firearms").select("name").eq("id", firearmId).maybeSingle(),
      ammunitionTypeId
        ? supabase
            .from("ammunition_types")
            .select("name")
            .eq("id", ammunitionTypeId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    await logAction(supabase, user.id, {
      action: AUDIT_ACTION.MATCH_FIREARM_SET,
      entityType: "match_entry",
      entityId: matchEntryId,
      metadata: {
        match_id: matchId || undefined,
        match_name: matchName,
        before: logBefore
          ? {
              firearm_id: logBefore.firearm_id,
              firearm_name: logBefore.firearms?.name,
              rounds_fired: logBefore.rounds_fired,
              ammunition_type_id: logBefore.ammunition_type_id,
              ammunition_name: logBefore.ammunition_types?.name,
            }
          : null,
        after: {
          firearm_id: firearmId,
          firearm_name: firearmRow?.name,
          rounds_fired: rounds,
          ammunition_type_id: ammunitionTypeId,
          ammunition_name: ammoRow?.name ?? null,
        },
      },
    });
  }

  if (matchId) revalidatePath(`/matches/${matchId}/me`);
  revalidatePath("/dashboard");
  revalidatePath("/firearms");

  // Preservamos el ?entry= para que el usuario quede en la misma división que
  // estaba editando — sino lo manda a la entry de mejor % por default y
  // pierde el contexto.
  const target = matchId
    ? `/matches/${matchId}/me?entry=${encodeURIComponent(matchEntryId)}`
    : "/dashboard";
  redirect(target);
}
