import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Match,
  MatchEntryWithRelations,
  MatchWithDiscipline,
  MyEntryRow,
  Stage,
} from "./types";

/** Matches importados por un usuario, más recientes primero. */
export async function listImportedByUser(
  supabase: SupabaseClient,
  userId: string,
  limit = 20,
): Promise<Match[]> {
  const { data } = await supabase
    .from("matches")
    .select("id, name, date, region, imported_at, imported_by_user_id, source_filename")
    .eq("imported_by_user_id", userId)
    .order("date", { ascending: false })
    .limit(limit);
  return (data as Match[] | null) ?? [];
}

/** Todos los matches visibles, más recientes primero. */
export async function listAllMatches(
  supabase: SupabaseClient,
  limit = 20,
): Promise<Match[]> {
  const { data } = await supabase
    .from("matches")
    .select("id, name, date, region, imported_at, imported_by_user_id, source_filename")
    .order("date", { ascending: false })
    .limit(limit);
  return (data as Match[] | null) ?? [];
}

/** Match con su disciplina embebida. */
export async function getMatchById(
  supabase: SupabaseClient,
  matchId: string,
): Promise<MatchWithDiscipline | null> {
  const { data } = await supabase
    .from("matches")
    .select(
      "id, name, date, region, imported_at, imported_by_user_id, source_filename, disciplines(name)",
    )
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
      "id, place, match_points, match_percentage, is_dq, power_factor, category, divisions(code, name), matches(id, name, date, region)",
    )
    .eq("shooter_id", shooterId)
    .order("matches(date)", { ascending: false });
  return (data as unknown as MyEntryRow[] | null) ?? [];
}
