import type { TypedSupabaseClient } from "../supabase/types";
import type {
  MatchEntryWithRelations,
  MatchWithDiscipline,
  MyEntryRow,
  MyMatchSummary,
  MyStageResultRow,
  MyStageRow,
  Stage,
} from "./types";
import { unwrap } from "./unwrap";

const MATCH_BASE_SELECT =
  "id, name, date, region, imported_at, imported_by_user_id, source_filename, min_shots, disciplines(code, name, scoring_type)";

/**
 * Versión paginada para `/matches`. Pide un rango (offset/limit) y trae el
 * count total para que la UI pueda calcular "Página X de Y". `count: "exact"`
 * es barato acá porque `matches` es una tabla chica — si en el futuro crece
 * a decenas de miles, conviene bajar a `"planned"` o `"estimated"`.
 */
export async function listMatchesPage(
  supabase: TypedSupabaseClient,
  { page, size }: { page: number; size: number },
): Promise<{ matches: MatchWithDiscipline[]; total: number }> {
  const from = (page - 1) * size;
  const to = from + size - 1;
  const res = await supabase
    .from("matches")
    .select(MATCH_BASE_SELECT, { count: "exact" })
    .order("date", { ascending: false })
    .range(from, to);
  const data = unwrap(res, "listMatchesPage");
  return {
    matches: data ?? [],
    total: res.count ?? 0,
  };
}

/**
 * Nombre de un match. Read de snapshot para audit metadata: ignora errores
 * y devuelve `null` (no usa `unwrap`) para preservar la semántica original.
 */
export async function getMatchName(
  supabase: TypedSupabaseClient,
  matchId: string,
): Promise<{ name: string } | null> {
  const { data } = await supabase
    .from("matches")
    .select("name")
    .eq("id", matchId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Snapshot of a match (with its discipline) for auditing its deletion.
 *
 * Selects `imported_by_user_id` because the server action needs it to
 * check permissions BEFORE deleting, without paying for a second query.
 */
export async function getMatchDeleteSnapshot(
  supabase: TypedSupabaseClient,
  matchId: string,
): Promise<{
  name: string;
  date: string;
  region: string | null;
  imported_by_user_id: string | null;
  disciplines: { code: string; name: string } | null;
} | null> {
  const { data } = await supabase
    .from("matches")
    .select("name, date, region, imported_by_user_id, disciplines(code, name)")
    .eq("id", matchId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Deletes a match by id. Returns how many rows it removed.
 *
 * The `.select("id")` is not cosmetic: PostgREST does **not** return an
 * error when RLS filters every row — it returns 200 with an empty body.
 * Without counting rows, a delete rejected by RLS is indistinguishable
 * from a successful one, and the caller ends up auditing and confirming
 * to the user a deletion that never happened. See issue #196.
 */
export async function deleteMatch(
  supabase: TypedSupabaseClient,
  matchId: string,
): Promise<{ affected: number; error: string | null }> {
  const { data, error } = await supabase
    .from("matches")
    .delete()
    .eq("id", matchId)
    .select("id");
  return {
    affected: Array.isArray(data) ? data.length : 0,
    error: error?.message ?? null,
  };
}

/**
 * Snapshot (name + region) of a match for auditing the club change.
 *
 * Includes `imported_by_user_id` so the server action can check
 * permissions with the same read it already needed for the before/after.
 */
export async function getMatchClubSnapshot(
  supabase: TypedSupabaseClient,
  matchId: string,
): Promise<{
  name: string;
  region: string | null;
  imported_by_user_id: string | null;
} | null> {
  const { data } = await supabase
    .from("matches")
    .select("name, region, imported_by_user_id")
    .eq("id", matchId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Updates a match's `region`. Returns how many rows it updated (see the
 * note on `deleteMatch` for why counting is necessary).
 *
 * **No longer filters by `imported_by_user_id`.** That filter locked out
 * admins, whom RLS has allowed since 0014 (`matches_update_admin`) and
 * whom `canEditMatch` always said could edit — the filter was the one
 * layer of four saying otherwise. See issue #197. Who may edit is decided
 * in the server action via `canEditMatch` and re-checked by RLS; a third
 * rule hidden in a query's `.eq()` is not needed.
 */
export async function updateMatchClub(
  supabase: TypedSupabaseClient,
  matchId: string,
  region: string | null,
): Promise<{ affected: number; error: string | null }> {
  const { data, error } = await supabase
    .from("matches")
    .update({ region })
    .eq("id", matchId)
    .select("id");
  return {
    affected: Array.isArray(data) ? data.length : 0,
    error: error?.message ?? null,
  };
}

/** Snapshot (name + min_shots + importador) para validar/auditar min_shots. */
export async function getMatchMinShotsSnapshot(
  supabase: TypedSupabaseClient,
  matchId: string,
): Promise<{
  name: string;
  min_shots: number | null;
  imported_by_user_id: string | null;
} | null> {
  const { data } = await supabase
    .from("matches")
    .select("name, min_shots, imported_by_user_id")
    .eq("id", matchId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Updates a match's `min_shots`. Returns affected rows (see the note on
 * `deleteMatch`).
 */
export async function updateMatchMinShots(
  supabase: TypedSupabaseClient,
  matchId: string,
  minShots: number | null,
): Promise<{ affected: number; error: string | null }> {
  const { data, error } = await supabase
    .from("matches")
    .update({ min_shots: minShots })
    .eq("id", matchId)
    .select("id");
  return {
    affected: Array.isArray(data) ? data.length : 0,
    error: error?.message ?? null,
  };
}

/**
 * Snapshot de un match_entry (con shooter + match embebidos) para validar
 * permisos y auditar el toggle de `is_absent`. Errores ignorados a propósito.
 */
export async function getEntryAbsentSnapshot(
  supabase: TypedSupabaseClient,
  entryId: string,
): Promise<{
  id: string;
  match_id: string;
  shooter_id: string;
  is_absent: boolean;
  match_points: number;
  match_percentage: number;
  shooters: { linked_user_id: string | null; full_name: string } | null;
  matches: { name: string; imported_by_user_id: string | null } | null;
} | null> {
  const { data } = await supabase
    .from("match_entries")
    .select(
      "id, match_id, shooter_id, is_absent, match_points, match_percentage, shooters(linked_user_id, full_name), matches(name, imported_by_user_id)",
    )
    .eq("id", entryId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Updates a match_entry's `is_absent` flag. Returns affected rows (see
 * the note on `deleteMatch`).
 */
export async function updateEntryAbsent(
  supabase: TypedSupabaseClient,
  entryId: string,
  isAbsent: boolean,
): Promise<{ affected: number; error: string | null }> {
  const { data, error } = await supabase
    .from("match_entries")
    .update({ is_absent: isAbsent })
    .eq("id", entryId)
    .select("id");
  return {
    affected: Array.isArray(data) ? data.length : 0,
    error: error?.message ?? null,
  };
}

/** Match con su disciplina embebida. */
export async function getMatchById(
  supabase: TypedSupabaseClient,
  matchId: string,
): Promise<MatchWithDiscipline | null> {
  const data = unwrap(
    await supabase
      .from("matches")
      .select(MATCH_BASE_SELECT)
      .eq("id", matchId)
      .maybeSingle(),
    "getMatchById",
  );
  return data ?? null;
}

/** Stages de un match, ordenados por número. */
export async function listStagesByMatch(
  supabase: TypedSupabaseClient,
  matchId: string,
): Promise<Stage[]> {
  const data = unwrap(
    await supabase
      .from("stages")
      .select("id, match_id, stage_number, name, max_points")
      .eq("match_id", matchId)
      .order("stage_number"),
    "listStagesByMatch",
  );
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
  supabase: TypedSupabaseClient,
  matchId: string,
): Promise<MatchEntryWithRelations[]> {
  const data = unwrap(
    await supabase
      .from("match_entries")
      .select(
        "id, match_id, shooter_id, division_id, classification, power_factor, category, place, match_points, match_percentage, total_time_seconds, hits, is_dq, is_absent, divisions(code, name), shooters(id, full_name, member_number, region, linked_user_id)",
      )
      .eq("match_id", matchId)
      // Ausentes y DQs van al final del listado para que el podio quede arriba.
      .order("is_absent", { ascending: true })
      .order("is_dq", { ascending: true })
      .order("place", { ascending: true }),
    "listEntriesByMatch",
  );
  // `power_factor` es `text` en la DB; el parser de import garantiza que solo
  // sea "Min" | "Maj" | null, así que estrechamos el tipo acá.
  return (data ?? []) as MatchEntryWithRelations[];
}

/**
 * Para cada (match_id, division_code) que aparece en los matches dados,
 * devuelve cuántos tiradores compitieron en esa división. Lo usamos para
 * calcular percentiles (place / total) en el dashboard.
 *
 * Devuelve un Map con clave `${matchId}|${divisionCode}` → count.
 */
export async function getDivisionSizes(
  supabase: TypedSupabaseClient,
  matchIds: string[],
): Promise<Map<string, number>> {
  if (matchIds.length === 0) return new Map();

  const data = unwrap(
    await supabase
      .from("match_entries")
      .select("match_id, divisions(code)")
      .in("match_id", matchIds),
    "getDivisionSizes",
  );

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
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
  supabase: TypedSupabaseClient,
  shooterIds: string[],
): Promise<MyEntryRow[]> {
  if (shooterIds.length === 0) return [];
  const data = unwrap(
    await supabase
      .from("match_entries")
      .select(
        // Embed `match_firearm_log(rounds_fired)`: la FK es UNIQUE (es la PK
        // de match_firearm_log), así que PostgREST devuelve un objeto
        // (no array). Si el tirador no registró su arma, viene null.
        // `matches.min_shots` se usa con `rounds_fired` para calcular
        // disparos extra (issue #75).
        "id, place, match_points, match_percentage, total_time_seconds, hits, is_dq, is_absent, power_factor, category, divisions(code, name), matches(id, name, date, region, min_shots, disciplines(code, name, scoring_type)), match_firearm_log(rounds_fired)",
      )
      .in("shooter_id", shooterIds)
      .order("matches(date)", { ascending: false }),
    "listEntriesByShooters",
  );
  // `power_factor` es `text` en la DB; el parser garantiza "Min" | "Maj" | null.
  return (data ?? []) as MyEntryRow[];
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
  supabase: TypedSupabaseClient,
  matchId: string,
  shooterIds: string[],
): Promise<MyMatchSummary["entry"][]> {
  if (shooterIds.length === 0) return [];

  const data = unwrap(
    await supabase
      .from("match_entries")
      .select(
        "id, place, match_points, match_percentage, total_time_seconds, hits, is_dq, is_absent, power_factor, category, classification, divisions(code, name)",
      )
      .eq("match_id", matchId)
      .in("shooter_id", shooterIds)
      .order("place", { ascending: true }),
    "listMyEntriesInMatch",
  );

  // `power_factor` es `text` en la DB; el parser garantiza "Min" | "Maj" | null.
  return (data ?? []) as MyMatchSummary["entry"][];
}

/**
 * Stage results de un match_entry específico, ordenados por número de stage.
 * Filtramos también por matchId para usar el join filter `stages.match_id`
 * y evitar leer stages que no son del match actual.
 */
export async function listStageResultsForEntry(
  supabase: TypedSupabaseClient,
  matchEntryId: string,
  matchId: string,
): Promise<MyStageResultRow[]> {
  const data = unwrap(
    await supabase
      .from("stage_results")
      .select(
        "id, points, penalties, time_seconds, hit_factor, stage_points, stage_percentage, place, hits, is_dq, stages!inner(id, stage_number, name, match_id)",
      )
      .eq("match_entry_id", matchEntryId)
      .eq("stages.match_id", matchId),
    "listStageResultsForEntry",
  );

  const results = data ?? [];
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
  supabase: TypedSupabaseClient,
  entryIds: string[],
): Promise<MyStageRow[]> {
  if (entryIds.length === 0) return [];
  const data = unwrap(
    await supabase
      .from("stage_results")
      .select("place, penalties, stage_percentage, is_dq")
      .in("match_entry_id", entryIds),
    "listMyStageResultsForEntries",
  );
  return (data as MyStageRow[] | null) ?? [];
}
