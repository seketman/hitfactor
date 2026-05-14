import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  MatchEntryWithRelations,
  MatchWithDiscipline,
  MyEntryRow,
  MyMatchSummary,
  MyStageResultRow,
  MyStageRow,
  Stage,
} from "./types";

const MATCH_BASE_SELECT =
  "id, name, date, region, imported_at, imported_by_user_id, source_filename, disciplines(code, name, scoring_type)";

/**
 * Versión paginada para `/matches`. Pide un rango (offset/limit) y trae el
 * count total para que la UI pueda calcular "Página X de Y". `count: "exact"`
 * es barato acá porque `matches` es una tabla chica — si en el futuro crece
 * a decenas de miles, conviene bajar a `"planned"` o `"estimated"`.
 */
export async function listMatchesPage(
  supabase: SupabaseClient,
  { page, size }: { page: number; size: number },
): Promise<{ matches: MatchWithDiscipline[]; total: number }> {
  const from = (page - 1) * size;
  const to = from + size - 1;
  const { data, count } = await supabase
    .from("matches")
    .select(MATCH_BASE_SELECT, { count: "exact" })
    .order("date", { ascending: false })
    .range(from, to);
  return {
    matches: (data as unknown as MatchWithDiscipline[] | null) ?? [],
    total: count ?? 0,
  };
}

/** Match con su disciplina embebida. */
export async function getMatchById(
  supabase: SupabaseClient,
  matchId: string,
): Promise<MatchWithDiscipline | null> {
  const { data } = await supabase
    .from("matches")
    .select(MATCH_BASE_SELECT)
    .eq("id", matchId)
    .maybeSingle();
  return (data as unknown as MatchWithDiscipline | null) ?? null;
}

/** Stages de un match, ordenados por número. */
export async function listStagesByMatch(
  supabase: SupabaseClient,
  matchId: string,
): Promise<Stage[]> {
  const { data } = await supabase
    .from("stages")
    .select("id, match_id, stage_number, name, max_points")
    .eq("match_id", matchId)
    .order("stage_number");
  return (data as Stage[] | null) ?? [];
}

/**
 * Match entries con shooter + division embebidos, ordenados por `place ASC`
 * (DQ al final).
 *
 * Ordenamos por `place` y no por `match_percentage` para respetar el ranking
 * computado por el parser de cada disciplina. En FBI por ejemplo el criterio
 * primario son los impactos, así que un tirador puede tener place=1 con
 * menos puntos (y por tanto menor %) que el de place=2 — ordenar por % daría
 * un ranking inconsistente con el campo place.
 */
export async function listEntriesByMatch(
  supabase: SupabaseClient,
  matchId: string,
): Promise<MatchEntryWithRelations[]> {
  const { data } = await supabase
    .from("match_entries")
    .select(
      "id, match_id, shooter_id, division_id, classification, power_factor, category, place, match_points, match_percentage, hits, is_dq, divisions(code, name), shooters(id, full_name, member_number, region, linked_user_id)",
    )
    .eq("match_id", matchId)
    .order("is_dq", { ascending: true })
    .order("place", { ascending: true });
  return (data as unknown as MatchEntryWithRelations[] | null) ?? [];
}

/**
 * Para cada (match_id, division_code) que aparece en los matches dados,
 * devuelve cuántos tiradores compitieron en esa división. Lo usamos para
 * calcular percentiles (place / total) en el dashboard.
 *
 * Devuelve un Map con clave `${matchId}|${divisionCode}` → count.
 */
export async function getDivisionSizes(
  supabase: SupabaseClient,
  matchIds: string[],
): Promise<Map<string, number>> {
  if (matchIds.length === 0) return new Map();

  type Row = { match_id: string; divisions: { code: string } | null };
  const { data } = await supabase
    .from("match_entries")
    .select("match_id, divisions(code)")
    .in("match_id", matchIds);

  const counts = new Map<string, number>();
  for (const row of (data as unknown as Row[] | null) ?? []) {
    if (!row.divisions) continue;
    const key = `${row.match_id}|${row.divisions.code}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Resultados agregados de uno o varios shooters en sus matches, más recientes
 * primero. Aceptamos múltiples IDs porque un usuario puede tener varias
 * identidades linkeadas (una por disciplina/torneo).
 */
export async function listEntriesByShooters(
  supabase: SupabaseClient,
  shooterIds: string[],
): Promise<MyEntryRow[]> {
  if (shooterIds.length === 0) return [];
  const { data } = await supabase
    .from("match_entries")
    .select(
      "id, place, match_points, match_percentage, total_time_seconds, hits, is_dq, power_factor, category, divisions(code, name), matches(id, name, date, region, disciplines(code, name, scoring_type))",
    )
    .in("shooter_id", shooterIds)
    .order("matches(date)", { ascending: false });
  return (data as unknown as MyEntryRow[] | null) ?? [];
}

/**
 * Match entries del usuario en un match dado. Si participó en varias
 * divisiones del mismo match (típico FBI: Pistola + PCC en el mismo
 * Social), devuelve **todas**, ordenadas por match_percentage descendente.
 *
 * Acepta `shooterIds` plural porque un usuario puede tener varias identidades
 * linkeadas; igual filtramos por todas en una sola query.
 */
export async function listMyEntriesInMatch(
  supabase: SupabaseClient,
  matchId: string,
  shooterIds: string[],
): Promise<MyMatchSummary["entry"][]> {
  if (shooterIds.length === 0) return [];

  const { data } = await supabase
    .from("match_entries")
    .select(
      "id, place, match_points, match_percentage, total_time_seconds, hits, is_dq, power_factor, category, classification, divisions(code, name)",
    )
    .eq("match_id", matchId)
    .in("shooter_id", shooterIds)
    .order("place", { ascending: true });

  return (data ?? []) as unknown as MyMatchSummary["entry"][];
}

/**
 * Stage results de un match_entry específico, ordenados por número de stage.
 * Filtramos también por matchId para usar el join filter `stages.match_id`
 * y evitar leer stages que no son del match actual.
 */
export async function listStageResultsForEntry(
  supabase: SupabaseClient,
  matchEntryId: string,
  matchId: string,
): Promise<MyStageResultRow[]> {
  const { data } = await supabase
    .from("stage_results")
    .select(
      "id, points, penalties, time_seconds, hit_factor, stage_points, stage_percentage, place, hits, is_dq, stages!inner(id, stage_number, name, match_id)",
    )
    .eq("match_entry_id", matchEntryId)
    .eq("stages.match_id", matchId);

  const results = (data as unknown as MyStageResultRow[] | null) ?? [];
  results.sort((a, b) => {
    const an = a.stages?.stage_number ?? Number.MAX_SAFE_INTEGER;
    const bn = b.stages?.stage_number ?? Number.MAX_SAFE_INTEGER;
    return an - bn;
  });
  return results;
}

/**
 * Trae todos los stage_results del usuario cruzados con sus match_entries.
 * Versión liviana (solo los campos para agregar KPIs cross-matches). Si la
 * lista de entry IDs viene vacía o si Supabase devuelve null, retorna `[]`.
 *
 * Para filtrar por disciplina: filtrar `entryIds` antes de llamar.
 */
export async function listMyStageResultsForEntries(
  supabase: SupabaseClient,
  entryIds: string[],
): Promise<MyStageRow[]> {
  if (entryIds.length === 0) return [];
  const { data } = await supabase
    .from("stage_results")
    .select("place, penalties, stage_percentage, is_dq")
    .in("match_entry_id", entryIds);
  return (data as MyStageRow[] | null) ?? [];
}
