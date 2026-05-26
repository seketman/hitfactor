import type { TypedSupabaseClient } from "../supabase/types";
import type {
  Firearm,
  FirearmUsageLog,
  FirearmUsageStats,
  MatchFirearmLog,
} from "./types";

/**
 * Catálogo de armas y log de uso por match. Todas las queries son
 * "self-scoped" — RLS se encarga de que el usuario solo vea/edite lo suyo.
 */

export async function listMyFirearms(
  supabase: TypedSupabaseClient,
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
  supabase: TypedSupabaseClient,
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
  supabase: TypedSupabaseClient,
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
 * Estadísticas agregadas de uso por arma del usuario. Suma TANTO los
 * match_firearm_log (uso en torneos) COMO los firearm_usage_log (uso
 * manual de práctica). `totalMatches` y `totalSessions` se exponen por
 * separado para que la UI pueda desglosar; `totalRounds` y `lastUsedDate`
 * son la unión de ambas fuentes.
 *
 * Dos queries en paralelo + agregación en memoria. La alternativa sería
 * una sola RPC con UNION ALL pero por ahora el volumen es chico y los
 * tipos generados de Supabase para RPCs son más fricción.
 */
export async function listFirearmUsageStats(
  supabase: TypedSupabaseClient,
  userId: string,
): Promise<FirearmUsageStats[]> {
  const firearms = await listMyFirearms(supabase, userId);
  if (firearms.length === 0) return [];
  const firearmIds = firearms.map((f) => f.id);

  const [matchLogsRes, usageLogsRes] = await Promise.all([
    supabase
      .from("match_firearm_log")
      .select("firearm_id, rounds_fired, match_entries(matches(date))")
      .in("firearm_id", firearmIds),
    supabase
      .from("firearm_usage_log")
      .select("firearm_id, rounds_fired, used_on")
      .in("firearm_id", firearmIds),
  ]);

  const byFirearm = new Map<
    string,
    {
      matches: number;
      sessions: number;
      rounds: number;
      lastDate: string | null;
    }
  >();
  for (const f of firearms) {
    byFirearm.set(f.id, {
      matches: 0,
      sessions: 0,
      rounds: 0,
      lastDate: null,
    });
  }

  const bump = (bucket: ReturnType<typeof byFirearm.get>, date: string | null) => {
    if (!bucket || !date) return;
    if (!bucket.lastDate || date > bucket.lastDate) bucket.lastDate = date;
  };

  for (const log of matchLogsRes.data ?? []) {
    const bucket = byFirearm.get(log.firearm_id);
    if (!bucket) continue;
    bucket.matches += 1;
    bucket.rounds += log.rounds_fired;
    bump(bucket, log.match_entries?.matches?.date ?? null);
  }

  for (const log of usageLogsRes.data ?? []) {
    const bucket = byFirearm.get(log.firearm_id);
    if (!bucket) continue;
    bucket.sessions += 1;
    bucket.rounds += log.rounds_fired;
    bump(bucket, log.used_on);
  }

  return firearms.map((f) => {
    const b = byFirearm.get(f.id)!;
    return {
      firearm: f,
      totalMatches: b.matches,
      totalSessions: b.sessions,
      totalRounds: b.rounds,
      lastUsedDate: b.lastDate,
    };
  });
}

/**
 * Lista los logs manuales de práctica de un arma, más recientes primero.
 * Embebe el nombre del tipo de munición usado (si está) para no requerir
 * un segundo round-trip en la página de detalle.
 */
export async function listFirearmUsageLog(
  supabase: TypedSupabaseClient,
  firearmId: string,
): Promise<
  Array<
    FirearmUsageLog & { ammunition_types: { name: string } | null }
  >
> {
  const { data } = await supabase
    .from("firearm_usage_log")
    .select(
      "id, firearm_id, ammunition_type_id, used_on, rounds_fired, notes, created_at, updated_at, ammunition_types(name)",
    )
    .eq("firearm_id", firearmId)
    .order("used_on", { ascending: false });
  return (data ?? []) as Array<
    FirearmUsageLog & { ammunition_types: { name: string } | null }
  >;
}

/**
 * Historial de uso de un arma específica: cada (match, rounds, date, ammo).
 * Más recientes primero. Embebe el nombre de la munición (si se registró
 * cuál se usó) — sino la columna "Munición" en `/firearms/[id]` queda
 * siempre vacía para los matches aunque el dato exista en `match_firearm_log`.
 */
export async function listFirearmHistory(
  supabase: TypedSupabaseClient,
  firearmId: string,
): Promise<
  Array<{
    matchEntryId: string;
    matchId: string;
    matchName: string;
    matchDate: string;
    disciplineName: string | null;
    roundsFired: number;
    ammoName: string | null;
  }>
> {
  const { data } = await supabase
    .from("match_firearm_log")
    .select(
      "match_entry_id, rounds_fired, ammunition_types(name), match_entries(id, matches(id, name, date, disciplines(name)))",
    )
    .eq("firearm_id", firearmId);

  const rows = data ?? [];

  return rows
    .filter((r) => r.match_entries?.matches)
    .map((r) => ({
      matchEntryId: r.match_entry_id,
      matchId: r.match_entries!.matches!.id,
      matchName: r.match_entries!.matches!.name,
      matchDate: r.match_entries!.matches!.date,
      disciplineName: r.match_entries!.matches!.disciplines?.name ?? null,
      roundsFired: r.rounds_fired,
      ammoName: r.ammunition_types?.name ?? null,
    }))
    .sort((a, b) => b.matchDate.localeCompare(a.matchDate));
}
