import type { TypedSupabaseClient } from "../supabase/types";
import type { AmmunitionType, AmmunitionUsageStats } from "./types";

/**
 * Catálogo de tipos de munición del tirador y stats de uso. Calcado del
 * patrón de `firearms.ts` (mismas decisiones de RLS y de shape de stats).
 * Todas las queries son self-scoped — la policy `ammunition_types_owner_all`
 * se encarga de que el usuario solo vea lo suyo.
 */

export async function listMyAmmo(
  supabase: TypedSupabaseClient,
  userId: string,
): Promise<AmmunitionType[]> {
  const { data } = await supabase
    .from("ammunition_types")
    .select("*")
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: true });
  return (data as AmmunitionType[] | null) ?? [];
}

export async function getAmmoById(
  supabase: TypedSupabaseClient,
  ammoId: string,
): Promise<AmmunitionType | null> {
  const { data } = await supabase
    .from("ammunition_types")
    .select("*")
    .eq("id", ammoId)
    .maybeSingle();
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

  const { data } = await supabase
    .from("match_firearm_log")
    .select("ammunition_type_id, rounds_fired, match_entries(matches(date))")
    .in(
      "ammunition_type_id",
      ammoList.map((a) => a.id),
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
  const { data } = await supabase
    .from("match_firearm_log")
    .select(
      "match_entry_id, rounds_fired, firearms(name), match_entries(id, matches(id, name, date, disciplines(name)))",
    )
    .eq("ammunition_type_id", ammoId);

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
