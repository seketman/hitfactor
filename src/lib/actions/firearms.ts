"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { redirectWithError } from "@/lib/redirects";
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

export async function createFirearm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    redirectWithError("/firearms", "Falta el nombre");
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const payload = {
    owner_user_id: userData.user.id,
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

  await logAction(supabase, userData.user.id, {
    action: AUDIT_ACTION.FIREARM_CREATE,
    entityType: "firearm",
    entityId: (created as { id?: string } | null)?.id,
    metadata: {
      name: payload.name,
      brand: payload.brand,
      model: payload.model,
      caliber: payload.caliber,
    },
  });

  revalidatePath("/firearms");
  revalidatePath("/dashboard");
  redirect("/firearms");
}

export async function updateFirearm(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) {
    redirectWithError("/firearms", "Datos incompletos");
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

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

  await logAction(supabase, userData.user.id, {
    action: AUDIT_ACTION.FIREARM_UPDATE,
    entityType: "firearm",
    entityId: id,
    metadata: {
      name: after.name,
      before: before ?? undefined,
      after,
    },
  });

  revalidatePath("/firearms");
  revalidatePath(`/firearms/${id}`);
  revalidatePath("/dashboard");
  redirect("/firearms");
}

export async function deleteFirearm(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

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
    type Snap = {
      name: string;
      brand: string | null;
      model: string | null;
      caliber: string | null;
    };
    const s = snapshot as unknown as Snap;
    await logAction(supabase, userData.user.id, {
      action: AUDIT_ACTION.FIREARM_DELETE,
      entityType: "firearm",
      entityId: id,
      metadata: {
        name: s.name,
        brand: s.brand,
        model: s.model,
        caliber: s.caliber,
      },
    });
  }

  revalidatePath("/firearms");
  revalidatePath("/dashboard");
  redirect("/firearms");
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

  if (!matchEntryId) return;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const errorTarget = matchId ? `/matches/${matchId}/me` : "/dashboard";

  // Snapshot del log actual + nombres de match/firearm para el audit log.
  // Hacemos las queries en paralelo, son chicas.
  type LogSnap = {
    firearm_id: string;
    rounds_fired: number;
    firearms: { name: string } | null;
  } | null;

  const [logRes, matchNameRes] = await Promise.all([
    supabase
      .from("match_firearm_log")
      .select("firearm_id, rounds_fired, firearms(name)")
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
  const logBefore = logRes.data as unknown as LogSnap;
  const matchName = (matchNameRes.data as { name?: string } | null)?.name;

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
      await logAction(supabase, userData.user.id, {
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
        notes: trimOrNull(formData.get("notes")),
      },
      { onConflict: "match_entry_id" },
    );
    if (error) {
      redirectWithError(errorTarget, error.message);
    }

    // Resolver el nombre del firearm asignado para el audit metadata.
    const { data: firearmRow } = await supabase
      .from("firearms")
      .select("name")
      .eq("id", firearmId)
      .maybeSingle();

    await logAction(supabase, userData.user.id, {
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
            }
          : null,
        after: {
          firearm_id: firearmId,
          firearm_name: (firearmRow as { name?: string } | null)?.name,
          rounds_fired: rounds,
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
