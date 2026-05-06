import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Firearm,
  FirearmUsageStats,
  MatchFirearmLog,
} from "./types";

/**
 * Catálogo de armas y log de uso por match. Todas las queries son
 * "self-scoped" — RLS se encarga de que el usuario solo vea/edite lo suyo.
 */

export async function listMyFirearms(
  supabase: SupabaseClient,
  userId: string,
): Promise<Firearm[]> {
  const { data } = await supabase
    .from("firearms")
    .select("*")
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: true });
  return (data as Firearm[] | null) ?? [];
}

export async function getFirearmById(
  supabase: SupabaseClient,
  firearmId: string,
): Promise<Firearm | null> {
  const { data } = await supabase
    .from("firearms")
    .select("*")
    .eq("id", firearmId)
    .maybeSingle();
  return (data as Firearm | null) ?? null;
}

export async function getMatchFirearmLog(
  supabase: SupabaseClient,
  matchEntryId: string,
): Promise<MatchFirearmLog | null> {
  const { data } = await supabase
    .from("match_firearm_log")
    .select("*")
    .eq("match_entry_id", matchEntryId)
    .maybeSingle();
  return (data as MatchFirearmLog | null) ?? null;
}

/**
 * Estadísticas agregadas de uso por arma del usuario:
 * total de matches en los que fue usada, total de tiros y último uso.
 *
 * Se hace una sola query al log + join contra matches para la fecha del
 * último uso.
 */
export async function listFirearmUsageStats(
  supabase: SupabaseClient,
  userId: string,
): Promise<FirearmUsageStats[]> {
  const firearms = await listMyFirearms(supabase, userId);
  if (firearms.length === 0) return [];

  type LogRow = {
    firearm_id: string;
    rounds_fired: number;
    match_entries: { matches: { date: string } | null } | null;
  };

  const { data } = await supabase
    .from("match_firearm_log")
    .select("firearm_id, rounds_fired, match_entries(matches(date))")
    .in(
      "firearm_id",
      firearms.map((f) => f.id),
    );

  const logs = (data as unknown as LogRow[] | null) ?? [];

  const byFirearm = new Map<
    string,
    { matches: number; rounds: number; lastDate: string | null }
  >();
  for (const f of firearms) {
    byFirearm.set(f.id, { matches: 0, rounds: 0, lastDate: null });
  }
  for (const log of logs) {
    const bucket = byFirearm.get(log.firearm_id);
    if (!bucket) continue;
    bucket.matches += 1;
    bucket.rounds += log.rounds_fired;
    const date = log.match_entries?.matches?.date ?? null;
    if (date && (!bucket.lastDate || date > bucket.lastDate)) {
      bucket.lastDate = date;
    }
  }

  return firearms.map((f) => {
    const b = byFirearm.get(f.id)!;
    return {
      firearm: f,
      totalMatches: b.matches,
      totalRounds: b.rounds,
      lastUsedDate: b.lastDate,
    };
  });
}

/**
 * Historial de uso de un arma específica: cada (match, rounds, date).
 * Más recientes primero.
 */
export async function listFirearmHistory(
  supabase: SupabaseClient,
  firearmId: string,
): Promise<
  Array<{
    matchEntryId: string;
    matchId: string;
    matchName: string;
    matchDate: string;
    disciplineName: string | null;
    roundsFired: number;
  }>
> {
  type Row = {
    match_entry_id: string;
    rounds_fired: number;
    match_entries: {
      id: string;
      matches: {
        id: string;
        name: string;
        date: string;
        disciplines: { name: string } | null;
      } | null;
    } | null;
  };

  const { data } = await supabase
    .from("match_firearm_log")
    .select(
      "match_entry_id, rounds_fired, match_entries(id, matches(id, name, date, disciplines(name)))",
    )
    .eq("firearm_id", firearmId);

  const rows = (data as unknown as Row[] | null) ?? [];

  return rows
    .filter((r) => r.match_entries?.matches)
    .map((r) => ({
      matchEntryId: r.match_entry_id,
      matchId: r.match_entries!.matches!.id,
      matchName: r.match_entries!.matches!.name,
      matchDate: r.match_entries!.matches!.date,
      disciplineName: r.match_entries!.matches!.disciplines?.name ?? null,
      roundsFired: r.rounds_fired,
    }))
    .sort((a, b) => b.matchDate.localeCompare(a.matchDate));
}
