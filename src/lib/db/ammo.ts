import type { TypedSupabaseClient } from "../supabase/types";
import type { AmmunitionType, AmmunitionUsageStats } from "./types";
import { unwrap } from "./unwrap";

/**
 * Catálogo de tipos de munición del tirador y stats de uso. Calcado del
 * patrón de `firearms.ts` (mismas decisiones de RLS y de shape de stats).
 * Todas las queries son self-scoped — la policy `ammunition_types_owner_all`
 * se encarga de que el usuario solo vea lo suyo.
 */

/**
 * Campos editables de un tipo de munición (sin `owner_user_id`). El insert
 * agrega el owner; el update reusa este mismo shape.
 */
export type AmmoValues = {
  name: string;
  type: "factory" | "reload";
  caliber: string | null;
  brand: string | null;
  bullet_weight_grains: number | null;
  bullet_type: string | null;
  powder: string | null;
  powder_charge_grains: number | null;
  power_factor: "Min" | "Maj" | null;
  power_factor_measured: number | null;
  notes: string | null;
};

/** Inserta un tipo de munición y devuelve su `id`. */
export async function createAmmo(
  supabase: TypedSupabaseClient,
  input: AmmoValues & { owner_user_id: string },
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from("ammunition_types")
    .insert(input)
    .select("id")
    .single();
  return { id: data?.id ?? null, error: error?.message ?? null };
}

/** Snapshot completo de un tipo de munición para auditar before/after. */
export async function getAmmoAuditSnapshot(
  supabase: TypedSupabaseClient,
  ammoId: string,
) {
  const { data } = await supabase
    .from("ammunition_types")
    .select(
      "name, type, caliber, brand, bullet_weight_grains, bullet_type, powder, powder_charge_grains, power_factor, power_factor_measured, notes",
    )
    .eq("id", ammoId)
    .maybeSingle();
  return data ?? null;
}

/** Snapshot reducido de un tipo de munición para auditar deletes. */
export async function getAmmoDeleteSnapshot(
  supabase: TypedSupabaseClient,
  ammoId: string,
) {
  const { data } = await supabase
    .from("ammunition_types")
    .select("name, type, caliber, brand")
    .eq("id", ammoId)
    .maybeSingle();
  return data ?? null;
}

/** Actualiza un tipo de munición. */
export async function updateAmmo(
  supabase: TypedSupabaseClient,
  ammoId: string,
  values: AmmoValues,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("ammunition_types")
    .update(values)
    .eq("id", ammoId);
  return { error: error?.message ?? null };
}

/** Borra un tipo de munición por id. */
export async function deleteAmmo(
  supabase: TypedSupabaseClient,
  ammoId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("ammunition_types")
    .delete()
    .eq("id", ammoId);
  return { error: error?.message ?? null };
}

export async function listMyAmmo(
  supabase: TypedSupabaseClient,
  userId: string,
): Promise<AmmunitionType[]> {
  const data = unwrap(
    await supabase
      .from("ammunition_types")
      .select("*")
      .eq("owner_user_id", userId)
      .order("created_at", { ascending: true }),
    "listMyAmmo",
  );
  return (data as AmmunitionType[] | null) ?? [];
}

export async function getAmmoById(
  supabase: TypedSupabaseClient,
  ammoId: string,
): Promise<AmmunitionType | null> {
  const data = unwrap(
    await supabase
      .from("ammunition_types")
      .select("*")
      .eq("id", ammoId)
      .maybeSingle(),
    "getAmmoById",
  );
  return (data as AmmunitionType | null) ?? null;
}

/**
 * Estadísticas agregadas por tipo: cuántos matches lo usaron, total de
 * tiros (sumados desde el match_firearm_log) y último uso. Mismo shape
 * que `FirearmUsageStats` pero con `ammo` en vez de `firearm`.
 */
export async function listAmmoUsageStats(
  supabase: TypedSupabaseClient,
  userId: string,
): Promise<AmmunitionUsageStats[]> {
  const ammoList = await listMyAmmo(supabase, userId);
  if (ammoList.length === 0) return [];

  const data = unwrap(
    await supabase
      .from("match_firearm_log")
      .select("ammunition_type_id, rounds_fired, match_entries(matches(date))")
      .in(
        "ammunition_type_id",
        ammoList.map((a) => a.id),
      ),
    "listAmmoUsageStats",
  );

  const logs = data ?? [];

  const byAmmo = new Map<
    string,
    { matches: number; rounds: number; lastDate: string | null }
  >();
  for (const a of ammoList) {
    byAmmo.set(a.id, { matches: 0, rounds: 0, lastDate: null });
  }
  for (const log of logs) {
    // ammunition_type_id es nullable en el log — descartamos esos rows.
    if (!log.ammunition_type_id) continue;
    const bucket = byAmmo.get(log.ammunition_type_id);
    if (!bucket) continue;
    bucket.matches += 1;
    bucket.rounds += log.rounds_fired;
    const date = log.match_entries?.matches?.date ?? null;
    if (date && (!bucket.lastDate || date > bucket.lastDate)) {
      bucket.lastDate = date;
    }
  }

  return ammoList.map((a) => {
    const b = byAmmo.get(a.id)!;
    return {
      ammo: a,
      totalMatches: b.matches,
      totalRounds: b.rounds,
      lastUsedDate: b.lastDate,
    };
  });
}

/**
 * Historial de uso de un tipo: cada (match, arma, rounds, date). Más
 * recientes primero. A diferencia del historial de arma, también
 * mostramos qué arma se usó con esta munición (los recargadores suelen
 * tener una munición específica por arma).
 */
export async function listAmmoHistory(
  supabase: TypedSupabaseClient,
  ammoId: string,
): Promise<
  Array<{
    matchEntryId: string;
    matchId: string;
    matchName: string;
    matchDate: string;
    disciplineName: string | null;
    firearmName: string;
    roundsFired: number;
  }>
> {
  const data = unwrap(
    await supabase
      .from("match_firearm_log")
      .select(
        "match_entry_id, rounds_fired, firearms(name), match_entries(id, matches(id, name, date, disciplines(name)))",
      )
      .eq("ammunition_type_id", ammoId),
    "listAmmoHistory",
  );

  const rows = data ?? [];

  return rows
    .filter((r) => r.match_entries?.matches)
    .map((r) => ({
      matchEntryId: r.match_entry_id,
      matchId: r.match_entries!.matches!.id,
      matchName: r.match_entries!.matches!.name,
      matchDate: r.match_entries!.matches!.date,
      disciplineName: r.match_entries!.matches!.disciplines?.name ?? null,
      firearmName: r.firearms?.name ?? "—",
      roundsFired: r.rounds_fired,
    }))
    .sort((a, b) => b.matchDate.localeCompare(a.matchDate));
}
