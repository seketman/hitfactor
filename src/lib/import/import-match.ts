import type { TypedSupabaseClient } from "../supabase/types";
import type {
  ParsedMatch,
  ParsedMatchEntry,
} from "@/lib/types/match";
import { ImportError } from "./import-error";
import { requireDivision } from "./helpers";
import { resolveShootersBulk, shooterCacheKey } from "./shooter-resolution";
import { attachStagesToMatch } from "./stage-attach";
import {
  findAnyMatchByDiscNameDate,
  findUserMatch,
  type MatchLookupRow,
} from "./match-dedup";

// Re-exports para mantener estables los paths de import existentes
// (`@/lib/import/import-match`) tras el split del módulo.
export { ImportError } from "./import-error";
export { resolveShootersBulk } from "./shooter-resolution";
export { findUserMatch, findAnyMatchByDiscNameDate } from "./match-dedup";

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

/**
 * Importa un ParsedMatch a la DB.
 * - Si trae match entries (file de Match Results): crea match + match_entries.
 * - Si trae stages (file de Stage Results): localiza el match existente y
 *   agrega stages + stage_results matcheando contra los match_entries.
 *
 * Asume que `supabase` está autenticado como el usuario que está importando.
 * El RLS valida que `imported_by_user_id = auth.uid()`.
 */
/**
 * Opciones del flujo de import. Hoy solo lleva `minShots` (disparos
 * mínimos del match — ver issue #75). Si en el futuro hay más metadata
 * "del importador" que no viene en el archivo, sumar acá.
 */
export interface ImportOptions {
  /**
   * Disparos mínimos por entry. Solo se aplica cuando se inserta un match
   * nuevo. Si la disciplina es FBI se ignora y se fuerza a 45. Si no
   * viene y no es FBI, queda NULL y el admin lo completa después.
   */
  minShots?: number | null;
}

export async function importParsedMatch(
  supabase: TypedSupabaseClient,
  parsed: ParsedMatch,
  importerUserId: string,
  filename: string,
  options: ImportOptions = {},
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

  // Si hay stages, lo tratamos como stage import. Si ADEMÁS vienen entries
  // pero todas son DQ, igualmente es stage import: el PDF de stages de
  // WinMSS clásico incluye al final la página "Disqualified Shooters", que
  // nuestro parser captura como entries con isDq=true. Esas entries no
  // significan que el archivo sea un overall — el overall está en otro PDF
  // separado. Las upsertearemos contra el match existente desde dentro de
  // importStages.
  const realEntries = parsed.matchEntries.filter((e) => !e.isDq);
  const isStageImport = parsed.stages.length > 0 && realEntries.length === 0;

  if (isStageImport) {
    return importStages(
      supabase,
      parsed,
      disciplineRef,
      divisionByCode,
      importerUserId,
      filename,
      options,
    );
  }

  return importMatchOverall(
    supabase,
    parsed,
    disciplineRef,
    divisionByCode,
    importerUserId,
    filename,
    options,
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
  supabase: TypedSupabaseClient,
  parsed: ParsedMatch,
  discipline: DisciplineRef,
  divisionByCode: Map<string, number>,
  importerUserId: string,
  filename: string,
  options: ImportOptions,
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
    // Idem importStages: si el form trae min_shots y el match aún no lo
    // tiene, lo seteamos. No pisamos un valor existente — para editarlo
    // está el botón "Editar mínimo" de la página del match.
    await maybeApplyMinShots(
      supabase,
      existingForUser.id,
      existingForUser.min_shots,
      options.minShots,
    );

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

  // No es un re-upload nuestro. Antes de insertar, chequeamos si OTRO
  // usuario ya importó el mismo match — la unique constraint a nivel DB
  // es (discipline, name, date, region) con NULLS NOT DISTINCT, así que
  // si ambos imports tienen distinta region (caso típico: uno HTML de
  // PractiScore que extrae "ARG-TFALP" de las filas y otro PDF de
  // WinMSS donde la region cae a null) se cuelan los dos como matches
  // distintos. Defendemos a nivel app: si encontramos uno con regions
  // "compatibles" (una nula, ambas nulas o iguales), rechazamos con un
  // error accionable que invita a marcarse "Soy yo" en el match
  // existente. Si las regions son explícitamente distintas (ambas no
  // nulas, valores distintos), asumimos torneos legítimamente
  // distintos (dos clubes con el mismo nombre en el mismo día — raro
  // pero posible) y dejamos pasar.
  const otherUserMatch = await findAnyMatchByDiscNameDate(
    supabase,
    discipline.id,
    parsed.name,
    parsed.date,
  );
  if (
    otherUserMatch &&
    otherUserMatch.imported_by_user_id !== importerUserId
  ) {
    const regionsCompatible =
      otherUserMatch.region == null ||
      parsed.region == null ||
      otherUserMatch.region === parsed.region;
    if (regionsCompatible) {
      throw new ImportError(
        'Este match ya fue importado por otra persona. Buscalo en la página de Matches y marcate con "Soy yo" en vez de volver a subirlo.',
        "MATCH_ALREADY_EXISTS_BY_OTHER",
      );
    }
  }

  // Insertamos. Si igual pega contra la unique constraint (race entre
  // dos imports concurrentes con misma region), reportamos error claro.
  //
  // `min_shots`: FBI siempre 45 (regla fija de la disciplina, ignoramos
  // lo que venga del form). Resto usa el valor del form (puede ser null
  // si el importer no lo completó — admin lo edita después).
  const minShots =
    discipline.code === "tiro_fbi" ? 45 : (options.minShots ?? null);

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
      min_shots: minShots,
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
  supabase: TypedSupabaseClient,
  parsed: ParsedMatch,
  discipline: DisciplineRef,
  divisionByCode: Map<string, number>,
  importerUserId: string,
  _filename: string,
  options: ImportOptions,
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

  // Si el form trae min_shots y el match todavía no lo tiene, lo aplicamos
  // ahora. Cubre el caso del usuario que omite min_shots en el primer
  // upload (overall) y lo completa en alguno posterior (stage import).
  await maybeApplyMinShots(supabase, matchId, matchRow.min_shots, options.minShots);

  // Si el archivo trae entries (en stages-only de WinMSS, son las DQs que
  // aparecen en la página "Disqualified Shooters" al final del PDF), las
  // mergeamos contra el match existente. Es no-op cuando ya las teníamos
  // del overall, y captura cualquier DQ que no hubiera quedado registrada.
  let insertedEntries = 0;
  if (parsed.matchEntries.length > 0) {
    insertedEntries = await upsertMatchEntries(
      supabase,
      parsed,
      matchId,
      divisionByCode,
    );
  }

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
    insertedEntries,
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
 * Resolución de shooters: bulk via `resolveShootersBulk` (una sola query
 * para todos los nombres en lugar de N round-trips).
 *
 * Devuelve la cantidad de entries que se procesaron (insertados +
 * actualizados — no distinguimos).
 */
async function upsertMatchEntries(
  supabase: TypedSupabaseClient,
  parsed: ParsedMatch,
  matchId: string,
  divisionByCode: Map<string, number>,
): Promise<number> {
  const shooterCache = await resolveShootersBulk(
    supabase,
    parsed.matchEntries.map((e) => e.shooter),
  );

  const entryRows = [];
  for (const entry of parsed.matchEntries) {
    const shooterId = shooterCache.get(shooterCacheKey(entry.shooter));
    if (!shooterId) continue; // safety: no debería pasar tras resolveShootersBulk
    const divisionId = requireDivision(divisionByCode, entry.divisionCode);
    entryRows.push(mapMatchEntryToRow(entry, matchId, shooterId, divisionId));
  }

  if (entryRows.length === 0) return 0;

  // Dedup defensivo por la conflict key (match_id, shooter_id, division_id).
  // Un mismo tirador puede aparecer 2+ veces en la misma división cuando el
  // oficial lo cargó duplicado (mismo nº de socio, nombre tipeado distinto):
  // todas las filas resuelven al mismo shooter_id. Postgres rechaza un
  // `INSERT ... ON CONFLICT DO UPDATE` que afecte la misma fila destino dos
  // veces ("cannot affect row a second time"), así que colapsamos a una por
  // clave quedándonos con el mejor resultado (mayor match_%, desempate por
  // menor place > 0).
  const bestByKey = new Map<string, (typeof entryRows)[number]>();
  let droppedDuplicates = 0;
  for (const row of entryRows) {
    const key = `${row.match_id}|${row.shooter_id}|${row.division_id}`;
    const prev = bestByKey.get(key);
    if (!prev) {
      bestByKey.set(key, row);
      continue;
    }
    droppedDuplicates++;
    if (isBetterEntry(row, prev)) bestByKey.set(key, row);
  }
  const dedupedRows = [...bestByKey.values()];
  if (droppedDuplicates > 0) {
    console.warn(
      `[import] ${droppedDuplicates} entry(s) duplicada(s) por (shooter, división) ` +
        "en el archivo — se mantuvo la de mejor resultado por clave.",
    );
  }

  const { error } = await supabase
    .from("match_entries")
    .upsert(dedupedRows, { onConflict: "match_id,shooter_id,division_id" });
  if (error) {
    throw new ImportError(
      `Error insertando resultados: ${error.message}`,
      "MATCH_ENTRIES_INSERT_FAILED",
    );
  }
  return dedupedRows.length;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Aplica `min_shots` a un match existente sólo si el match todavía no lo
 * tiene seteado en DB y el usuario lo proveyó en el form. Esto permite
 * "completarlo después" del primer import (caso típico: el usuario sube
 * primero el overall sin min_shots, después lo agrega al subir un stage).
 *
 * No pisa un valor existente. Si el usuario quiere cambiar un min_shots
 * ya seteado, debe usar el botón "Editar mínimo" de la página del match
 * (que además queda registrado en el audit log con before/after).
 */
async function maybeApplyMinShots(
  supabase: TypedSupabaseClient,
  matchId: string,
  currentMinShots: number | null,
  optionsMinShots: number | null | undefined,
): Promise<void> {
  if (optionsMinShots == null) return;
  if (currentMinShots != null) return;
  await supabase
    .from("matches")
    .update({ min_shots: optionsMinShots })
    .eq("id", matchId);
}

/**
 * Compara dos filas de match_entry que colisionan en la misma clave
 * (shooter, división) y decide cuál conservar. Gana el mejor resultado:
 * mayor `match_percentage`; a igualdad, el de menor `place` válido (> 0;
 * place 0 = DQ/ausente, peor). Determinista para que el dedup sea estable.
 */
function isBetterEntry(
  candidate: { match_percentage: number; place: number },
  current: { match_percentage: number; place: number },
): boolean {
  if (candidate.match_percentage !== current.match_percentage) {
    return candidate.match_percentage > current.match_percentage;
  }
  const candPlace = candidate.place > 0 ? candidate.place : Infinity;
  const curPlace = current.place > 0 ? current.place : Infinity;
  return candPlace < curPlace;
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
    is_absent: entry.isAbsent,
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

/**
 * Resuelve el match al que pertenece un archivo de stage.
 * Prioriza match exacto por (name limpio, date); si falla, busca por
 * prefijo entre los matches del mismo día y disciplina.
 *
 * Exportada para testing del algoritmo de prefijo.
 */
async function resolveMatchForStage(
  supabase: TypedSupabaseClient,
  parsed: ParsedMatch,
  disciplineId: number,
): Promise<MatchLookupRow | null> {
  const cleanName = stripStageSuffix(parsed.name);

  // 1) Match exacto.
  const { data: exact } = await supabase
    .from("matches")
    .select("id, name, imported_by_user_id, min_shots")
    .eq("discipline_id", disciplineId)
    .eq("name", cleanName)
    .eq("date", parsed.date)
    .maybeSingle();
  if (exact) return exact as MatchLookupRow;

  // 2) Fallback: matches del mismo día y disciplina, buscamos prefijo.
  const { data: sameDay } = await supabase
    .from("matches")
    .select("id, name, imported_by_user_id, min_shots")
    .eq("discipline_id", disciplineId)
    .eq("date", parsed.date);

  return findBestPrefixMatch(parsed.name, (sameDay ?? []) as MatchLookupRow[]);
}

/**
 * Resuelve un match candidato a partir del título del stage entre matches
 * del mismo día/disciplina. Estrategia:
 *
 *  1. **Forward prefix**: el nombre del match es prefijo del título del
 *     stage (convención PractiScore: "Final Curso - Stage 1" → "Final Curso").
 *     Se prefiere el match con nombre MÁS LARGO (más específico).
 *
 *  2. **Reverse prefix** (fallback): el título del stage limpio es prefijo
 *     del nombre del match. Cubre el caso "el usuario renombró el match
 *     después del import original con un sufijo para distinguirlo en su
 *     historial" — ej. "Final Curso" en el archivo, "Final Curso 2025-06"
 *     en DB. Solo se acepta si hay EXACTAMENTE UN candidato reverse —
 *     múltiples serían ambiguos (no podríamos decidir cuál).
 *
 * Exportada para testing.
 */
export function findBestPrefixMatch<T extends { name: string }>(
  stageTitle: string,
  candidates: T[],
): T | null {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();

  const PREFIX_SEPS = [" ", "-", " -", " –", " —"]; // last two: en-dash, em-dash

  const startsWithSep = (haystack: string, needle: string): boolean => {
    if (haystack === needle) return true;
    return PREFIX_SEPS.some((sep) => haystack.startsWith(needle + sep));
  };

  const targetDirty = norm(stageTitle);

  // 1) Forward: nombre del match es prefijo del título del stage.
  let best: T | null = null;
  for (const c of candidates) {
    const cn = norm(c.name);
    if (cn.length === 0) continue;
    if (startsWithSep(targetDirty, cn)) {
      if (!best || c.name.length > best.name.length) best = c;
    }
  }
  if (best) return best;

  // 2) Reverse fallback: título limpio del stage es prefijo del nombre del
  // match. Solo aceptamos si hay un único candidato — múltiples serían
  // ambiguos (ej. "Final Curso 2025-06" y "Final Curso 2024-12" ambos
  // empiezan con "Final Curso"). El strip del sufijo del stage acá es
  // independiente al que hace el caller para la búsqueda exacta — pasamos
  // por stripStageSuffix sí o sí para no depender del orden de pasos.
  const targetClean = norm(stripStageSuffix(stageTitle));
  if (targetClean.length === 0) return null;
  const reverseHits: T[] = [];
  for (const c of candidates) {
    const cn = norm(c.name);
    if (cn === targetClean) continue; // ya lo hubiese cazado el forward exacto
    if (startsWithSep(cn, targetClean)) reverseHits.push(c);
  }
  return reverseHits.length === 1 ? reverseHits[0]! : null;
}

async function listSameDayMatchNames(
  supabase: TypedSupabaseClient,
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
