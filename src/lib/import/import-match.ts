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
  disciplineCode: string;
  disciplineName: string;
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
  // Resolver disciplina (id, code, name) y divisiones
  const { data: discipline, error: discErr } = await supabase
    .from("disciplines")
    .select("id, code, name")
    .eq("code", parsed.discipline)
    .single();
  if (discErr || !discipline) {
    throw new ImportError(
      `Disciplina desconocida: ${parsed.discipline}`,
      "UNKNOWN_DISCIPLINE",
    );
  }
  const disciplineRef: DisciplineRef = {
    id: discipline.id as number,
    code: discipline.code as string,
    name: discipline.name as string,
  };

  const { data: divisionsData, error: divErr } = await supabase
    .from("divisions")
    .select("id, code")
    .eq("discipline_id", disciplineRef.id);
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
      disciplineRef,
      divisionByCode,
      importerUserId,
      filename,
    );
  }

  return importMatchOverall(
    supabase,
    parsed,
    disciplineRef,
    divisionByCode,
    importerUserId,
    filename,
  );
}

interface DisciplineRef {
  id: number;
  code: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Match overall (Match Results - Combined o por división)
// ---------------------------------------------------------------------------

async function importMatchOverall(
  supabase: SupabaseClient,
  parsed: ParsedMatch,
  discipline: DisciplineRef,
  divisionByCode: Map<string, number>,
  importerUserId: string,
  filename: string,
): Promise<ImportResult> {
  // Pre-check: ¿el usuario ya importó un match equivalente?
  //
  // Buscamos por (discipline, name, date) **ignorando region** y filtrando por
  // imported_by_user_id. Esto cubre dos casos:
  //  1. Re-upload del mismo CSV (region coincide). El INSERT directo pegaría
  //     contra la unique constraint igual.
  //  2. Re-upload tras editar el club desde la UI. La region cambió en DB
  //     pero el CSV trae la region original (o null para FBI), por lo que el
  //     INSERT no chocaría contra la constraint y crearía un duplicado.
  //
  // Si el match ya existe lo MERGEAMOS en lugar de fallar: upsert de
  // match_entries por (match_id, shooter_id, division_id) + upsert de
  // stage_results vía attachStagesToMatch. Esto permite re-importar un
  // archivo corregido (o con campos nuevos del parser, ej. `hits` para FBI)
  // sin perder los datos asociados al match: club editado a mano
  // (matches.region), claims tirador→usuario (shooters.linked_user_id) y
  // armas registradas (firearms) viven fuera de match_entries/stage_results
  // y se preservan.
  const existingForUser = await findUserMatch(
    supabase,
    discipline.id,
    parsed.name,
    parsed.date,
    importerUserId,
  );

  if (existingForUser) {
    const upsertedEntries = await upsertMatchEntries(
      supabase,
      parsed,
      existingForUser.id,
      divisionByCode,
    );
    let stagesCount = 0;
    let resultsCount = 0;
    if (parsed.stages.length > 0) {
      const r = await attachStagesToMatch(
        supabase,
        parsed,
        existingForUser.id,
        divisionByCode,
      );
      stagesCount = r.stagesCount;
      resultsCount = r.resultsCount;
    }
    return {
      matchId: existingForUser.id,
      matchName: existingForUser.name,
      matchDate: parsed.date,
      disciplineCode: discipline.code,
      disciplineName: discipline.name,
      insertedEntries: upsertedEntries,
      insertedStages: stagesCount,
      insertedStageResults: resultsCount,
      existedAlready: true,
    };
  }

  // No es un re-upload nuestro. Insertamos. Si pega contra la unique
  // constraint, es porque otro usuario ya lo importó con esa (region) —
  // reportamos error claro.
  const { data: matchRow, error: matchErr } = await supabase
    .from("matches")
    .insert({
      discipline_id: discipline.id,
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
        "Este match ya fue importado por otro usuario.",
        "MATCH_ALREADY_EXISTS",
      );
    }
    throw new ImportError(matchErr.message, "MATCH_INSERT_FAILED");
  }
  const matchId = matchRow!.id as string;

  const insertedEntries = await upsertMatchEntries(
    supabase,
    parsed,
    matchId,
    divisionByCode,
  );

  // Si el archivo trae stages embebidos (caso Steel Challenge), los
  // insertamos en la misma operación.
  let insertedStages = 0;
  let insertedStageResults = 0;
  if (parsed.stages.length > 0) {
    const { stagesCount, resultsCount } = await attachStagesToMatch(
      supabase,
      parsed,
      matchId,
      divisionByCode,
    );
    insertedStages = stagesCount;
    insertedStageResults = resultsCount;
  }

  return {
    matchId,
    matchName: parsed.name,
    matchDate: parsed.date,
    disciplineCode: discipline.code,
    disciplineName: discipline.name,
    insertedEntries,
    insertedStages,
    insertedStageResults,
    existedAlready: false,
  };
}

// ---------------------------------------------------------------------------
// Stages (Stage Results - X)
// ---------------------------------------------------------------------------

async function importStages(
  supabase: SupabaseClient,
  parsed: ParsedMatch,
  discipline: DisciplineRef,
  divisionByCode: Map<string, number>,
  importerUserId: string,
  _filename: string,
): Promise<ImportResult> {
  // Resolver el match al que pertenece este stage:
  // 1) Limpiamos sufijos conocidos del título del stage ("Stage N",
  //    "Ejercicio N", "Etapa N", etc.) y buscamos por nombre exacto.
  // 2) Fallback: buscamos matches del mismo día/disciplina cuyo nombre
  //    sea prefijo del título del stage (cubre cualquier sufijo desconocido
  //    que no esté en stripStageSuffix).
  const matchRow = await resolveMatchForStage(supabase, parsed, discipline.id);

  if (!matchRow) {
    const candidatesText = await listSameDayMatchNames(
      supabase,
      discipline.id,
      parsed.date,
    );
    const detail = candidatesText
      ? ` Matches existentes del ${parsed.date}: ${candidatesText}.`
      : ` No hay matches importados con fecha ${parsed.date} todavía.`;
    throw new ImportError(
      `No se pudo asociar el stage a un match existente.${detail} Importá primero el archivo de "Match Results" del torneo.`,
      "MATCH_NOT_FOUND",
    );
  }

  if (matchRow.imported_by_user_id !== importerUserId) {
    throw new ImportError(
      "Solo el usuario que importó el match original puede agregarle stages.",
      "NOT_MATCH_OWNER",
    );
  }
  const matchId = matchRow.id;
  const matchName = matchRow.name;

  const { stagesCount, resultsCount } = await attachStagesToMatch(
    supabase,
    parsed,
    matchId,
    divisionByCode,
  );

  return {
    matchId,
    matchName,
    matchDate: parsed.date,
    disciplineCode: discipline.code,
    disciplineName: discipline.name,
    insertedEntries: 0,
    insertedStages: stagesCount,
    insertedStageResults: resultsCount,
    existedAlready: true,
  };
}

// ---------------------------------------------------------------------------
// Match entries upsert (idempotente, usado tanto en primer import como
// en re-upload)
// ---------------------------------------------------------------------------

/**
 * Resuelve shooters y hace UPSERT de match_entries con onConflict en
 * `(match_id, shooter_id, division_id)` — la unique constraint del schema.
 *
 * Idempotente: si el match ya tenía estos entries, los actualiza con los
 * datos del archivo (place, points, hits, etc.). Si trae entries nuevos,
 * los inserta. Los entries en DB que NO estén en el archivo quedan como
 * están — no los borramos para no romper claims/firearms vinculados a
 * ellos por FK.
 *
 * Resolución de shooters: secuencial y cacheada para evitar duplicados
 * por carrera cuando un mismo nombre aparece en varias divisiones.
 *
 * Devuelve la cantidad de entries que se procesaron (insertados +
 * actualizados — no distinguimos).
 */
async function upsertMatchEntries(
  supabase: SupabaseClient,
  parsed: ParsedMatch,
  matchId: string,
  divisionByCode: Map<string, number>,
): Promise<number> {
  const shooterCache = new Map<string, string>();
  const entryRows = [];
  for (const entry of parsed.matchEntries) {
    const cacheKey = shooterCacheKey(entry.shooter);
    let shooterId = shooterCache.get(cacheKey);
    if (!shooterId) {
      shooterId = await findOrCreateShooter(supabase, entry.shooter);
      shooterCache.set(cacheKey, shooterId);
    }
    const divisionId = requireDivision(divisionByCode, entry.divisionCode);
    entryRows.push(mapMatchEntryToRow(entry, matchId, shooterId, divisionId));
  }

  if (entryRows.length === 0) return 0;

  const { error } = await supabase
    .from("match_entries")
    .upsert(entryRows, { onConflict: "match_id,shooter_id,division_id" });
  if (error) {
    throw new ImportError(
      `Error insertando resultados: ${error.message}`,
      "MATCH_ENTRIES_INSERT_FAILED",
    );
  }
  return entryRows.length;
}

// ---------------------------------------------------------------------------
// Stages attachment (compartido entre Steel match overall e IPSC stage import)
// ---------------------------------------------------------------------------

async function attachStagesToMatch(
  supabase: SupabaseClient,
  parsed: ParsedMatch,
  matchId: string,
  divisionByCode: Map<string, number>,
): Promise<{ stagesCount: number; resultsCount: number }> {
  let stagesCount = 0;
  let resultsCount = 0;

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
      stagesCount++;
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
      resultsCount += stageResultRows.length;
    }
  }

  return { stagesCount, resultsCount };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clave de cache para deduplicar tiradores dentro del mismo import. */
function shooterCacheKey(s: ParsedShooter): string {
  return `${s.fullName.trim().toLowerCase()}|${s.memberNumber ?? ""}`;
}

async function findOrCreateShooter(
  supabase: SupabaseClient,
  parsed: ParsedShooter,
): Promise<string> {
  // Usamos `limit(1)` + orden estable en lugar de `maybeSingle()` porque
  // este último devuelve null silenciosamente cuando hay >1 match —
  // típicamente porque ya hay shooters duplicados en la DB de imports
  // anteriores. Si ese null caía a INSERT, generábamos un duplicado más.
  // Acá, si encontramos al menos uno, lo reusamos (preferimos los que
  // tienen claim para no romper el linkeo del usuario).
  let query = supabase
    .from("shooters")
    .select("id")
    .ilike("full_name", parsed.fullName);

  if (parsed.memberNumber) {
    query = query.eq("member_number", parsed.memberNumber);
  } else {
    query = query.is("member_number", null);
  }

  const { data: existing } = await query
    .order("linked_user_id", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(1);
  if (existing && existing.length > 0) return existing[0]!.id as string;

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
    total_time_seconds: entry.totalTimeSeconds,
    hits: entry.hits,
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
    hits: result.hits,
    is_dq: result.isDq,
  };
}

/**
 * Quita sufijos conocidos del título de un stage para recuperar el nombre del match.
 * Cubre variantes en inglés y español frecuentes en PractiScore:
 *   "Stage N", "Ejercicio N", "Etapa N", "Stand N", "Match N",
 *   con o sin punto en la abreviatura (Ej., St.).
 *
 * Ej:
 *   "TP ESCOPETA 20/02/26 TFALP - Stage 1" -> "TP ESCOPETA 20/02/26 TFALP"
 *   "2° RanKing Social - Ejercicio 6"      -> "2° RanKing Social"
 */
export function stripStageSuffix(name: string): string {
  return name
    .replace(
      /\s*[-–—]\s*(Stage|Ejercicio|Ej\.?|Stand|St\.?|Etapa|Match)\s+\d+(?:\s*\([^)]*\))?\s*$/i,
      "",
    )
    .trim();
}

interface MatchLookupRow {
  id: string;
  name: string;
  imported_by_user_id: string;
}

/**
 * Resuelve el match al que pertenece un archivo de stage.
 * Prioriza match exacto por (name limpio, date); si falla, busca por
 * prefijo entre los matches del mismo día y disciplina.
 *
 * Exportada para testing del algoritmo de prefijo.
 */
async function resolveMatchForStage(
  supabase: SupabaseClient,
  parsed: ParsedMatch,
  disciplineId: number,
): Promise<MatchLookupRow | null> {
  const cleanName = stripStageSuffix(parsed.name);

  // 1) Match exacto.
  const { data: exact } = await supabase
    .from("matches")
    .select("id, name, imported_by_user_id")
    .eq("discipline_id", disciplineId)
    .eq("name", cleanName)
    .eq("date", parsed.date)
    .maybeSingle();
  if (exact) return exact as MatchLookupRow;

  // 2) Fallback: matches del mismo día y disciplina, buscamos prefijo.
  const { data: sameDay } = await supabase
    .from("matches")
    .select("id, name, imported_by_user_id")
    .eq("discipline_id", disciplineId)
    .eq("date", parsed.date);

  return findBestPrefixMatch(parsed.name, (sameDay ?? []) as MatchLookupRow[]);
}

/**
 * Devuelve el match cuyo nombre normalizado es prefijo del título del stage,
 * priorizando el más largo (más específico). Exportada para testing.
 */
export function findBestPrefixMatch<T extends { name: string }>(
  stageTitle: string,
  candidates: T[],
): T | null {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/gu, "")
      .toLowerCase()
      .trim();

  const target = norm(stageTitle);
  let best: T | null = null;

  for (const c of candidates) {
    const cn = norm(c.name);
    if (cn.length === 0) continue;
    const isPrefix =
      target === cn ||
      target.startsWith(cn + " ") ||
      target.startsWith(cn + "-") ||
      target.startsWith(cn + " -") ||
      target.startsWith(cn + " –") || // en-dash
      target.startsWith(cn + " —"); // em-dash
    if (isPrefix && (!best || c.name.length > best.name.length)) {
      best = c;
    }
  }

  return best;
}

/**
 * Busca un match del usuario por (discipline, name, date), **ignorando la
 * region**. Se usa antes de insertar para detectar re-uploads incluso si
 * el region en DB fue editado por el usuario después del import original
 * (ej. botón "Editar club" en /matches/[id]).
 *
 * Si hay más de uno (caso anómalo de duplicados pre-existentes en DB),
 * elegimos el más antiguo — asumiendo que ese fue el "original" y que
 * los más nuevos son ramas erróneas a limpiar.
 */
async function findUserMatch(
  supabase: SupabaseClient,
  disciplineId: number,
  name: string,
  date: string,
  importerUserId: string,
): Promise<MatchLookupRow | null> {
  const { data } = await supabase
    .from("matches")
    .select("id, name, imported_by_user_id, imported_at")
    .eq("discipline_id", disciplineId)
    .eq("name", name)
    .eq("date", date)
    .eq("imported_by_user_id", importerUserId)
    .order("imported_at", { ascending: true })
    .limit(1);
  const rows = data as MatchLookupRow[] | null;
  return rows && rows.length > 0 ? rows[0]! : null;
}

async function listSameDayMatchNames(
  supabase: SupabaseClient,
  disciplineId: number,
  date: string,
): Promise<string> {
  const { data } = await supabase
    .from("matches")
    .select("name")
    .eq("discipline_id", disciplineId)
    .eq("date", date);
  const names = (data ?? []).map((m: { name: string }) => `"${m.name}"`);
  return names.join(", ");
}
