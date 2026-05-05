import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ParsedMatch,
  ParsedMatchEntry,
  ParsedShooter,
  ParsedStageResult,
} from "@/lib/types/match";

export interface ImportResult {
  matchId: string;
  matchName: string;
  matchDate: string;
  insertedEntries: number;
  insertedStages: number;
  insertedStageResults: number;
  /** True si el match ya existía y solo agregamos stages */
  existedAlready: boolean;
}

export class ImportError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

/**
 * Importa un ParsedMatch a la DB.
 * - Si trae match entries (file de Match Results): crea match + match_entries.
 * - Si trae stages (file de Stage Results): localiza el match existente y
 *   agrega stages + stage_results matcheando contra los match_entries.
 *
 * Asume que `supabase` está autenticado como el usuario que está importando.
 * El RLS valida que `imported_by_user_id = auth.uid()`.
 */
export async function importParsedMatch(
  supabase: SupabaseClient,
  parsed: ParsedMatch,
  importerUserId: string,
  filename: string,
): Promise<ImportResult> {
  // Resolver discipline_id y divisions
  const { data: discipline, error: discErr } = await supabase
    .from("disciplines")
    .select("id")
    .eq("code", parsed.discipline)
    .single();
  if (discErr || !discipline) {
    throw new ImportError(
      `Disciplina desconocida: ${parsed.discipline}`,
      "UNKNOWN_DISCIPLINE",
    );
  }
  const disciplineId = discipline.id as number;

  const { data: divisionsData, error: divErr } = await supabase
    .from("divisions")
    .select("id, code")
    .eq("discipline_id", disciplineId);
  if (divErr || !divisionsData) {
    throw new ImportError("No se pudieron cargar las divisiones", "DIVISIONS_FETCH_FAILED");
  }
  const divisionByCode = new Map<string, number>();
  for (const d of divisionsData) divisionByCode.set(d.code, d.id);

  const isStageImport = parsed.stages.length > 0 && parsed.matchEntries.length === 0;

  if (isStageImport) {
    return importStages(
      supabase,
      parsed,
      disciplineId,
      divisionByCode,
      importerUserId,
      filename,
    );
  }

  return importMatchOverall(
    supabase,
    parsed,
    disciplineId,
    divisionByCode,
    importerUserId,
    filename,
  );
}

// ---------------------------------------------------------------------------
// Match overall (Match Results - Combined o por división)
// ---------------------------------------------------------------------------

async function importMatchOverall(
  supabase: SupabaseClient,
  parsed: ParsedMatch,
  disciplineId: number,
  divisionByCode: Map<string, number>,
  importerUserId: string,
  filename: string,
): Promise<ImportResult> {
  // Insertar match. Si ya existe (UNIQUE constraint), error.
  const { data: matchRow, error: matchErr } = await supabase
    .from("matches")
    .insert({
      discipline_id: disciplineId,
      name: parsed.name,
      date: parsed.date,
      region: parsed.region,
      source_type: parsed.source,
      source_filename: filename,
      imported_by_user_id: importerUserId,
    })
    .select("id")
    .single();

  if (matchErr) {
    if (matchErr.code === "23505") {
      throw new ImportError(
        "Este match ya fue importado por otra persona. Si querés, podés subir solo los stages que falten.",
        "MATCH_ALREADY_EXISTS",
      );
    }
    throw new ImportError(matchErr.message, "MATCH_INSERT_FAILED");
  }
  const matchId = matchRow!.id as string;

  // Resolver/crear shooters e insertar match_entries
  const entryRows = await Promise.all(
    parsed.matchEntries.map(async (entry) => {
      const shooterId = await findOrCreateShooter(supabase, entry.shooter);
      const divisionId = requireDivision(divisionByCode, entry.divisionCode);
      return mapMatchEntryToRow(entry, matchId, shooterId, divisionId);
    }),
  );

  if (entryRows.length > 0) {
    const { error: entryErr } = await supabase.from("match_entries").insert(entryRows);
    if (entryErr) {
      throw new ImportError(
        `Error insertando resultados: ${entryErr.message}`,
        "MATCH_ENTRIES_INSERT_FAILED",
      );
    }
  }

  return {
    matchId,
    matchName: parsed.name,
    matchDate: parsed.date,
    insertedEntries: entryRows.length,
    insertedStages: 0,
    insertedStageResults: 0,
    existedAlready: false,
  };
}

// ---------------------------------------------------------------------------
// Stages (Stage Results - X)
// ---------------------------------------------------------------------------

async function importStages(
  supabase: SupabaseClient,
  parsed: ParsedMatch,
  disciplineId: number,
  divisionByCode: Map<string, number>,
  importerUserId: string,
  _filename: string,
): Promise<ImportResult> {
  // Buscar el match existente. El nombre del archivo de stage incluye
  // " - Stage N" en el heading, pero el name del ParsedMatch ya viene
  // limpio (sin esa parte) gracias al parser.
  const matchName = stripStageSuffix(parsed.name);

  const { data: matchRow, error: matchErr } = await supabase
    .from("matches")
    .select("id, imported_by_user_id")
    .eq("discipline_id", disciplineId)
    .eq("name", matchName)
    .eq("date", parsed.date)
    .maybeSingle();

  if (matchErr) {
    throw new ImportError(matchErr.message, "MATCH_LOOKUP_FAILED");
  }
  if (!matchRow) {
    throw new ImportError(
      `Primero hay que importar el archivo de "Match Results" (${matchName} - ${parsed.date}).`,
      "MATCH_NOT_FOUND",
    );
  }
  if (matchRow.imported_by_user_id !== importerUserId) {
    throw new ImportError(
      "Solo el usuario que importó el match original puede agregarle stages.",
      "NOT_MATCH_OWNER",
    );
  }
  const matchId = matchRow.id as string;

  let totalStages = 0;
  let totalResults = 0;

  for (const stage of parsed.stages) {
    // Insertar stage (puede existir si reimportan)
    const { data: existingStage } = await supabase
      .from("stages")
      .select("id")
      .eq("match_id", matchId)
      .eq("stage_number", stage.stageNumber)
      .maybeSingle();

    let stageId: string;
    if (existingStage) {
      stageId = existingStage.id;
    } else {
      const { data: newStage, error: stageErr } = await supabase
        .from("stages")
        .insert({
          match_id: matchId,
          stage_number: stage.stageNumber,
          name: stage.name,
        })
        .select("id")
        .single();
      if (stageErr) {
        throw new ImportError(stageErr.message, "STAGE_INSERT_FAILED");
      }
      stageId = newStage!.id;
      totalStages++;
    }

    // Para cada resultado, encontrar match_entry correspondiente
    const stageResultRows = [];
    for (const result of stage.results) {
      const shooterId = await findOrCreateShooter(supabase, result.shooter);
      const divisionId = requireDivision(divisionByCode, result.divisionCode);

      const { data: matchEntry } = await supabase
        .from("match_entries")
        .select("id")
        .eq("match_id", matchId)
        .eq("shooter_id", shooterId)
        .eq("division_id", divisionId)
        .maybeSingle();

      if (!matchEntry) {
        // El tirador aparece en el stage pero no en el match overall.
        // Lo skipeamos silenciosamente — puede pasar con DQs raros.
        continue;
      }

      stageResultRows.push(mapStageResultToRow(result, stageId, matchEntry.id));
    }

    if (stageResultRows.length > 0) {
      const { error: resErr } = await supabase
        .from("stage_results")
        .upsert(stageResultRows, { onConflict: "stage_id,match_entry_id" });
      if (resErr) {
        throw new ImportError(resErr.message, "STAGE_RESULTS_INSERT_FAILED");
      }
      totalResults += stageResultRows.length;
    }
  }

  return {
    matchId,
    matchName,
    matchDate: parsed.date,
    insertedEntries: 0,
    insertedStages: totalStages,
    insertedStageResults: totalResults,
    existedAlready: true,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findOrCreateShooter(
  supabase: SupabaseClient,
  parsed: ParsedShooter,
): Promise<string> {
  let query = supabase
    .from("shooters")
    .select("id")
    .ilike("full_name", parsed.fullName);

  if (parsed.memberNumber) {
    query = query.eq("member_number", parsed.memberNumber);
  } else {
    query = query.is("member_number", null);
  }

  const { data: existing } = await query.maybeSingle();
  if (existing) return existing.id as string;

  const { data: created, error } = await supabase
    .from("shooters")
    .insert({
      full_name: parsed.fullName,
      member_number: parsed.memberNumber,
      region: parsed.region,
    })
    .select("id")
    .single();

  if (error) throw new ImportError(error.message, "SHOOTER_INSERT_FAILED");
  return created!.id as string;
}

function requireDivision(
  divisionByCode: Map<string, number>,
  code: string,
): number {
  const id = divisionByCode.get(code);
  if (!id) {
    throw new ImportError(
      `División no reconocida: "${code}". Pedile a un admin que la agregue.`,
      "UNKNOWN_DIVISION",
    );
  }
  return id;
}

function mapMatchEntryToRow(
  entry: ParsedMatchEntry,
  matchId: string,
  shooterId: string,
  divisionId: number,
) {
  return {
    match_id: matchId,
    shooter_id: shooterId,
    division_id: divisionId,
    classification: entry.classification,
    power_factor: entry.powerFactor,
    category: entry.category,
    place: entry.place,
    match_points: entry.matchPoints,
    match_percentage: entry.matchPercentage,
    is_dq: entry.isDq,
  };
}

function mapStageResultToRow(
  result: ParsedStageResult,
  stageId: string,
  matchEntryId: string,
) {
  return {
    stage_id: stageId,
    match_entry_id: matchEntryId,
    points: result.points,
    penalties: result.penalties,
    time_seconds: result.timeSeconds,
    hit_factor: result.hitFactor,
    stage_points: result.stagePoints,
    stage_percentage: result.stagePercentage,
    place: result.place || null,
    is_dq: result.isDq,
  };
}

function stripStageSuffix(name: string): string {
  // "TP ESCOPETA 20/02/26 TFALP - Stage 1" -> "TP ESCOPETA 20/02/26 TFALP"
  return name.replace(/\s*-\s*Stage\s+\d+\s*$/i, "").trim();
}
