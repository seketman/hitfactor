"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { redirectWithError } from "@/lib/redirects";

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

  const { error } = await supabase.from("firearms").insert({
    owner_user_id: userData.user.id,
    name,
    brand: trimOrNull(formData.get("brand")),
    model: trimOrNull(formData.get("model")),
    caliber: trimOrNull(formData.get("caliber")),
    notes: trimOrNull(formData.get("notes")),
  });

  if (error) {
    redirectWithError("/firearms", error.message);
  }

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

  const { error } = await supabase
    .from("firearms")
    .update({
      name,
      brand: trimOrNull(formData.get("brand")),
      model: trimOrNull(formData.get("model")),
      caliber: trimOrNull(formData.get("caliber")),
      notes: trimOrNull(formData.get("notes")),
    })
    .eq("id", id);

  if (error) {
    redirectWithError("/firearms", error.message);
  }

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

  const { error } = await supabase.from("firearms").delete().eq("id", id);
  if (error) {
    redirectWithError("/firearms", error.message);
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

  if (!firearmId) {
    // Limpiar el log para este match_entry
    const { error } = await supabase
      .from("match_firearm_log")
      .delete()
      .eq("match_entry_id", matchEntryId);
    if (error) {
      redirectWithError(errorTarget, error.message);
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
  }

  if (matchId) revalidatePath(`/matches/${matchId}/me`);
  revalidatePath("/dashboard");
  revalidatePath("/firearms");
  redirect(matchId ? `/matches/${matchId}/me` : "/dashboard");
}
