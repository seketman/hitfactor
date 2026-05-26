"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { redirectWithError } from "@/lib/redirects";
import { requireUser } from "@/lib/supabase/require-user";
import { AUDIT_ACTION, logAction } from "@/lib/audit/log-action";

/**
 * Acciones para administrar el catálogo de tipos de munición del tirador.
 * Misma forma que `firearms.ts`: RLS valida ownership, acá normalizamos
 * inputs y manejamos audit + redirects.
 *
 * Reglas de validación:
 *  - `name` y `type` son obligatorios; el resto es opcional.
 *  - `type` debe ser exactamente "factory" o "reload" (CHECK en la DB).
 *  - `bullet_weight_grains` y `powder_charge_grains` son numéricos
 *    opcionales — null si vacío o inválido.
 */

function trimOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Parsea un campo numérico opcional no-negativo. Null si vacío, inválido
 * o negativo. Acepta coma decimal (es-AR) y punto.
 *
 * Usado para grains (peso de punta, carga de pólvora) y para power factor
 * medido — todos números no-negativos con la misma tolerancia de input.
 */
function parseNumericOrNull(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function parseAmmoType(value: unknown): "factory" | "reload" | null {
  if (value === "factory" || value === "reload") return value;
  return null;
}

function parsePowerFactor(value: unknown): "Min" | "Maj" | null {
  if (value === "Min" || value === "Maj") return value;
  return null;
}

function revalidateAmmoPaths(id?: string) {
  revalidatePath("/ammo");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/ammo/${id}`);
}

export async function createAmmo(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const type = parseAmmoType(formData.get("type"));
  if (!name) {
    redirectWithError("/ammo", "Falta el nombre");
  }
  if (!type) {
    redirectWithError("/ammo", "Falta el tipo (factory o reload)");
  }

  const { supabase, user } = await requireUser();

  const payload = {
    owner_user_id: user.id,
    name,
    type,
    caliber: trimOrNull(formData.get("caliber")),
    brand: trimOrNull(formData.get("brand")),
    bullet_weight_grains: parseNumericOrNull(formData.get("bullet_weight_grains")),
    bullet_type: trimOrNull(formData.get("bullet_type")),
    powder: trimOrNull(formData.get("powder")),
    powder_charge_grains: parseNumericOrNull(formData.get("powder_charge_grains")),
    power_factor: parsePowerFactor(formData.get("power_factor")),
    power_factor_measured: parseNumericOrNull(
      formData.get("power_factor_measured"),
    ),
    notes: trimOrNull(formData.get("notes")),
  };

  const { data: created, error } = await supabase
    .from("ammunition_types")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    redirectWithError("/ammo", error.message);
  }

  await logAction(supabase, user.id, {
    action: AUDIT_ACTION.AMMO_CREATE,
    entityType: "ammunition_type",
    entityId: created?.id,
    metadata: {
      name: payload.name,
      type: payload.type,
      caliber: payload.caliber,
      brand: payload.brand,
    },
  });

  revalidateAmmoPaths();
  redirect("/ammo");
}

export async function updateAmmo(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const type = parseAmmoType(formData.get("type"));
  if (!id || !name || !type) {
    redirectWithError("/ammo", "Datos incompletos");
  }

  const { supabase, user } = await requireUser();

  const { data: before } = await supabase
    .from("ammunition_types")
    .select(
      "name, type, caliber, brand, bullet_weight_grains, bullet_type, powder, powder_charge_grains, power_factor, power_factor_measured, notes",
    )
    .eq("id", id)
    .maybeSingle();

  const after = {
    name,
    type,
    caliber: trimOrNull(formData.get("caliber")),
    brand: trimOrNull(formData.get("brand")),
    bullet_weight_grains: parseNumericOrNull(formData.get("bullet_weight_grains")),
    bullet_type: trimOrNull(formData.get("bullet_type")),
    powder: trimOrNull(formData.get("powder")),
    powder_charge_grains: parseNumericOrNull(formData.get("powder_charge_grains")),
    power_factor: parsePowerFactor(formData.get("power_factor")),
    power_factor_measured: parseNumericOrNull(
      formData.get("power_factor_measured"),
    ),
    notes: trimOrNull(formData.get("notes")),
  };

  const { error } = await supabase
    .from("ammunition_types")
    .update(after)
    .eq("id", id);

  if (error) {
    redirectWithError(`/ammo/${id}`, error.message);
  }

  await logAction(supabase, user.id, {
    action: AUDIT_ACTION.AMMO_UPDATE,
    entityType: "ammunition_type",
    entityId: id,
    metadata: {
      name: after.name,
      before: before ?? undefined,
      after,
    },
  });

  revalidateAmmoPaths(id);
  redirect("/ammo");
}

export async function deleteAmmo(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { supabase, user } = await requireUser();

  // Snapshot antes de borrar. El FK match_firearm_log.ammunition_type_id
  // está con ON DELETE SET NULL, así que los logs históricos quedan
  // desvinculados pero no se destruyen.
  const { data: snapshot } = await supabase
    .from("ammunition_types")
    .select("name, type, caliber, brand")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("ammunition_types")
    .delete()
    .eq("id", id);

  if (error) {
    redirectWithError("/ammo", error.message);
  }

  if (snapshot) {
    await logAction(supabase, user.id, {
      action: AUDIT_ACTION.AMMO_DELETE,
      entityType: "ammunition_type",
      entityId: id,
      metadata: {
        name: snapshot.name,
        type: snapshot.type,
        caliber: snapshot.caliber,
        brand: snapshot.brand,
      },
    });
  }

  revalidateAmmoPaths();
  redirect("/ammo");
}
