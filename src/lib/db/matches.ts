import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  MatchEntryWithRelations,
  MatchWithDiscipline,
  MyEntryRow,
  MyMatchSummary,
  MyStageResultRow,
  Stage,
} from "./types";

const MATCH_BASE_SELECT =
  "id, name, date, region, imported_at, imported_by_user_id, source_filename, disciplines(code, name)";

/** Matches importados por un usuario, más recientes primero. */
export async function listImportedByUser(
  supabase: SupabaseClient,
  userId: string,
  limit = 20,
): Promise<MatchWithDiscipline[]> {
  const { data } = await supabase
    .from("matches")
    .select(MATCH_BASE_SELECT)
    .eq("imported_by_user_id", userId)
    .order("date", { ascending: false })
    .limit(limit);
  return (data as unknown as MatchWithDiscipline[] | null) ?? [];
}

/** Todos los matches visibles, más recientes primero. */
export async function listAllMatches(
  supabase: SupabaseClient,
  limit = 20,
): Promise<MatchWithDiscipline[]> {
  const { data } = await supabase
    .from("matches")
    .select(MATCH_BASE_SELECT)
    .order("date", { ascending: false })
    .limit(limit);
  return (data as unknown as MatchWithDiscipline[] | null) ?? [];
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

/** Match entries con shooter + division embebidos, ordenados por % desc (DQ al final). */
export async function listEntriesByMatch(
  supabase: SupabaseClient,
  matchId: string,
): Promise<MatchEntryWithRelations[]> {
  const { data } = await supabase
    .from("match_entries")
    .select(
      "id, match_id, shooter_id, division_id, classification, power_factor, category, place, match_points, match_percentage, is_dq, divisions(code, name), shooters(id, full_name, member_number, region, linked_user_id)",
    )
    .eq("match_id", matchId)
    .order("is_dq", { ascending: true })
    .order("match_percentage", { ascending: false });
  return (data as unknown as MatchEntryWithRelations[] | null) ?? [];
}

/** Resultados de un shooter en todos sus matches, más recientes primero. */
export async function listEntriesByShooter(
  supabase: SupabaseClient,
  shooterId: string,
): Promise<MyEntryRow[]> {
  const { data } = await supabase
    .from("match_entries")
    .select(
      "id, place, match_points, match_percentage, is_dq, power_factor, category, divisions(code, name), matches(id, name, date, region, disciplines(code, name))",
    )
    .eq("shooter_id", shooterId)
    .order("matches(date)", { ascending: false });
  return (data as unknown as MyEntryRow[] | null) ?? [];
}

/**
 * Resumen de la participación de un shooter en un match específico:
 * el match con disciplina, su match_entry, y todos sus stage_results
 * (ordenados por número de stage).
 *
 * Devuelve null si el shooter no participó del match.
 */
export async function getMyMatchSummary(
  supabase: SupabaseClient,
  matchId: string,
  shooterId: string,
): Promise<MyMatchSummary | null> {
  const match = await getMatchById(supabase, matchId);
  if (!match) return null;

  const { data: entryData } = await supabase
    .from("match_entries")
    .select(
      "id, place, match_points, match_percentage, is_dq, power_factor, category, classification, divisions(code, name)",
    )
    .eq("match_id", matchId)
    .eq("shooter_id", shooterId)
    .maybeSingle();

  if (!entryData) return null;
  const entry = entryData as unknown as MyMatchSummary["entry"];

  const { data: stageData } = await supabase
    .from("stage_results")
    .select(
      "id, points, penalties, time_seconds, hit_factor, stage_points, stage_percentage, place, is_dq, stages!inner(id, stage_number, name, match_id)",
    )
    .eq("match_entry_id", entry.id)
    .eq("stages.match_id", matchId);

  const stageResults =
    (stageData as unknown as MyStageResultRow[] | null) ?? [];

  // Orden por número de stage (los nulls al final).
  stageResults.sort((a, b) => {
    const an = a.stages?.stage_number ?? Number.MAX_SAFE_INTEGER;
    const bn = b.stages?.stage_number ?? Number.MAX_SAFE_INTEGER;
    return an - bn;
  });

  return { match, entry, stageResults };
}
