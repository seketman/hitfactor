import type { TypedSupabaseClient } from "../supabase/types";
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

  // No es un re-upload nuestro. Insertamos. Si pega contra la unique
  // constraint, es porque otro usuario ya lo importó con esa (region) —
  // reportamos error claro.
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
  supabase: TypedSupabaseClient,
  parsed: ParsedMatch,
  matchId: string,
  divisionByCode: Map<string, number>,
): Promise<{ stagesCount: number; resultsCount: number }> {
  if (parsed.stages.length === 0) return { stagesCount: 0, resultsCount: 0 };

  // `stageNumber` puede ser null si el parser no lo pudo determinar;
  // no podemos asociarlo a una fila concreta de la tabla `stages`, así
  // que filtramos a no-null antes de cualquier resolución.
  const stagesWithNumber = parsed.stages.filter(
    (s): s is typeof s & { stageNumber: number } => s.stageNumber != null,
  );
  if (stagesWithNumber.length === 0) {
    return { stagesCount: 0, resultsCount: 0 };
  }

  // -- 1. Resolución bulk de stages (1 SELECT + opcionalmente 1 INSERT
  //       en lugar de N round-trips, uno por stage).
  const { data: existingStagesData } = await supabase
    .from("stages")
    .select("id, stage_number")
    .eq("match_id", matchId);
  const stageIdByNumber = new Map<number, string>();
  for (const s of existingStagesData ?? []) {
    stageIdByNumber.set(s.stage_number as number, s.id as string);
  }
  const newStageRows = stagesWithNumber
    .filter((s) => !stageIdByNumber.has(s.stageNumber))
    .map((s) => ({
      match_id: matchId,
      stage_number: s.stageNumber,
      name: s.name,
    }));
  let stagesCount = 0;
  if (newStageRows.length > 0) {
    const { data: created, error: stageErr } = await supabase
      .from("stages")
      .insert(newStageRows)
      .select("id, stage_number");
    if (stageErr) {
      throw new ImportError(stageErr.message, "STAGE_INSERT_FAILED");
    }
    for (const s of created ?? []) {
      stageIdByNumber.set(s.stage_number as number, s.id as string);
    }
    stagesCount = newStageRows.length;
  }

  // -- 2. Resolución bulk de match_entries POR NOMBRE + DIVISIÓN.
  //
  //       Antes resolvíamos shooterId vía `resolveShootersBulk` y después
  //       lookupeábamos match_entry por (shooter_id, division). Pero la
  //       cache de shooters dedup-ea por `(fullName, memberNumber)` y los
  //       archivos de stages de PractiScore NO traen número de socio. Si
  //       un tirador competía en dos divisiones del mismo match con
  //       variantes de nombre que `stripNameSuffixes` colapsa (ej.
  //       "CELIZ, Martin PCC" / "CELIZ, Martin" → ambos a "CELIZ, Martin"),
  //       ambos parsed stage results recibían el MISMO shooterId. El
  //       fallback "1 entry única" mandaba ambos al mismo match_entry_id
  //       y el upsert pegaba con `ON CONFLICT DO UPDATE command cannot
  //       affect row a second time`.
  //
  //       Fix: lookupear el match_entry directamente por (nombre
  //       normalizado, división). Eso elimina el shooterId como
  //       intermediario y garantiza que cada parsed stage result va al
  //       match_entry de su división correcta.
  const { data: allEntriesData } = await supabase
    .from("match_entries")
    .select("id, shooter_id, division_id")
    .eq("match_id", matchId);

  const shooterIdsInMatch = [
    ...new Set((allEntriesData ?? []).map((e) => e.shooter_id as string)),
  ];
  const shooterNameById = new Map<string, string>();
  if (shooterIdsInMatch.length > 0) {
    const { data: shootersData } = await supabase
      .from("shooters")
      .select("id, full_name")
      .in("id", shooterIdsInMatch);
    for (const s of shootersData ?? []) {
      shooterNameById.set(s.id as string, s.full_name as string);
    }
  }

  // Índice principal: (nombre normalizado, division_id) → match_entry_id.
  const entryByNameDiv = new Map<string, string>();
  // Fallback: (nombre normalizado) → match_entry_id[]. Usado cuando la
  // división del archivo de stages no matchea la del overall (caso TFABA
  // WinMSS: "PISTOLA" en overall sale como "PRODUCTION" en stages).
  const entriesByName = new Map<string, string[]>();
  for (const e of allEntriesData ?? []) {
    const fullName = shooterNameById.get(e.shooter_id as string);
    if (!fullName) continue;
    const normName = normalizeNameForMatch(fullName);
    const entryId = e.id as string;
    entryByNameDiv.set(`${normName}|${e.division_id}`, entryId);
    const arr = entriesByName.get(normName) ?? [];
    arr.push(entryId);
    entriesByName.set(normName, arr);
  }

  // -- 3. Loop sin round-trips: armamos un único batch con TODOS los
  //       stage_results y hacemos un solo upsert al final.
  const stageResultRows: ReturnType<typeof mapStageResultToRow>[] = [];
  for (const stage of stagesWithNumber) {
    const stageId = stageIdByNumber.get(stage.stageNumber);
    if (!stageId) continue; // no debería pasar tras paso 1
    for (const result of stage.results) {
      const divisionId = requireDivision(divisionByCode, result.divisionCode);
      const normName = normalizeNameForMatch(result.shooter.fullName);

      let entryId = entryByNameDiv.get(`${normName}|${divisionId}`);
      if (!entryId) {
        // Fallback: el tirador no aparece en esa división. Pasa cuando el
        // archivo de stages usa un nombre de división distinto al del
        // overall para los mismos tiradores (caso WinMSS de TFABA:
        // "PISTOLA" en el overall sale como "PRODUCTION" en el stages
        // PDF). Si el tirador tiene exactamente UNA entry en el match
        // (en otra división), la usamos. Si tiene varias, skipeamos.
        const entries = entriesByName.get(normName) ?? [];
        if (entries.length === 1) {
          entryId = entries[0]!;
        } else if (entries.length > 1) {
          console.warn(
            `[stage-attach] tirador "${result.shooter.fullName}" con ${entries.length} entries en el match (división ${result.divisionCode}): no se puede resolver sin ambigüedad`,
          );
          continue;
        } else {
          // No hay entries: el tirador aparece en stages pero no en
          // overall. Caso de DQ raro o re-import parcial. Skipeamos.
          continue;
        }
      }

      stageResultRows.push(mapStageResultToRow(result, stageId, entryId));
    }
  }

  // -- 5. UPSERT batched de TODOS los stage_results en una sola call.
  if (stageResultRows.length === 0) {
    return { stagesCount, resultsCount: 0 };
  }
  const { error: resErr } = await supabase
    .from("stage_results")
    .upsert(stageResultRows, { onConflict: "stage_id,match_entry_id" });
  if (resErr) {
    throw new ImportError(resErr.message, "STAGE_RESULTS_INSERT_FAILED");
  }
  return { stagesCount, resultsCount: stageResultRows.length };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clave de cache para deduplicar tiradores dentro del mismo import. */
function shooterCacheKey(s: ParsedShooter): string {
  return `${s.fullName.trim().toLowerCase()}|${s.memberNumber ?? ""}`;
}

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
 * Normaliza un nombre para matchear un parsed stage result contra un
 * `shooters.full_name` ya en DB. Lowercase + collapse de whitespace +
 * trim. No strip-ea acentos: dos apellidos que difieren por una tilde
 * son personas distintas. Tampoco strip-ea sufijos: el parser ya corrió
 * `stripNameSuffixes` antes de que llegue acá, así que ambos lados
 * (archivo y DB) tienen el mismo nombre canónico.
 */
function normalizeNameForMatch(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Resuelve un batch de shooters parseados a sus `id`s de DB en pocas
 * round-trips, en lugar de un round-trip por shooter como hacía la
 * versión per-row.
 *
 * Estrategia (en orden de prioridad):
 *  1. Dedup por `shooterCacheKey` (lowercase fullName + memberNumber).
 *  2. 1 SELECT con `.in('member_number', uniqueNumbers)` para reusar
 *     shooters ya conocidos cuando el import trae número de socio. El
 *     número es un identificador estable que sobrevive a typos del
 *     apellido (caso real: el mismo Oscar Stocker tipeado como "Stoker
 *     Oscar" sin número y como "STOCKER, Oscar Alfredo" con número 793 —
 *     el número los une cuando alguno de los imports lo trae).
 *  3. 1 SELECT con `.in('full_name', uniqueNames)` para los que todavía
 *     no resolvió el paso 2 (case-sensitive — el hit rate es ~100% en
 *     re-uploads del mismo formato).
 *  4. Fallback a `findOrCreateShooter` per-row para los misses, que usa
 *     `ilike` (case-insensitive) e inserta si tampoco existe con otra
 *     capitalización.
 *
 * Devuelve un `Map<shooterCacheKey, shooterId>` listo para ser consultado
 * por el caller sin más round-trips.
 */
async function resolveShootersBulk(
  supabase: TypedSupabaseClient,
  parsedShooters: ParsedShooter[],
): Promise<Map<string, string>> {
  const cache = new Map<string, string>();

  const uniqueByKey = new Map<string, ParsedShooter>();
  for (const s of parsedShooters) {
    if (!s.fullName?.trim()) continue;
    uniqueByKey.set(shooterCacheKey(s), s);
  }
  const unique = [...uniqueByKey.values()];
  if (unique.length === 0) return cache;

  // Paso 2: bulk lookup por member_number. Solo consultamos los parsed
  // shooters que traen número — si no, no hay nada que matchear acá.
  const memberNumbers = [
    ...new Set(
      unique
        .map((s) => s.memberNumber?.trim())
        .filter((n): n is string => !!n),
    ),
  ];
  const dbByMemberNumber = new Map<string, string>();
  if (memberNumbers.length > 0) {
    const { data: byNumberRows } = await supabase
      .from("shooters")
      .select("id, member_number, linked_user_id, created_at")
      .in("member_number", memberNumbers);

    // Si la DB tiene >1 shooter con el mismo número (no debería pero
    // puede pasar por imports duplicados pre-fix), preferimos el linkeado
    // y más viejo — mismo criterio que el path por nombre.
    const grouped = new Map<
      string,
      Array<{ id: string; linked: boolean; createdAt: string }>
    >();
    for (const row of byNumberRows ?? []) {
      const num = (row.member_number as string | null)?.trim();
      if (!num) continue;
      const arr = grouped.get(num) ?? [];
      arr.push({
        id: row.id as string,
        linked: row.linked_user_id != null,
        createdAt: (row.created_at as string) ?? "",
      });
      grouped.set(num, arr);
    }
    for (const [num, candidates] of grouped) {
      candidates.sort((a, b) => {
        if (a.linked !== b.linked) return a.linked ? -1 : 1;
        return a.createdAt.localeCompare(b.createdAt);
      });
      dbByMemberNumber.set(num, candidates[0]!.id);
    }
  }

  // Paso 3: bulk fetch por nombre exacto. Solo para los que todavía no
  // resolvió el paso 2.
  const stillUnresolved = unique.filter((s) => {
    const num = s.memberNumber?.trim();
    return !(num && dbByMemberNumber.has(num));
  });
  const names = [...new Set(stillUnresolved.map((s) => s.fullName))];
  const dbByKey = new Map<
    string,
    Array<{ id: string; linked: boolean; createdAt: string }>
  >();
  if (names.length > 0) {
    const { data: rows } = await supabase
      .from("shooters")
      .select("id, full_name, member_number, linked_user_id, created_at")
      .in("full_name", names);

    for (const row of rows ?? []) {
      const key = shooterCacheKey({
        fullName: row.full_name as string,
        memberNumber: (row.member_number as string | null) ?? null,
        region: null,
      });
      const arr = dbByKey.get(key) ?? [];
      arr.push({
        id: row.id as string,
        linked: row.linked_user_id != null,
        createdAt: (row.created_at as string) ?? "",
      });
      dbByKey.set(key, arr);
    }
  }

  const missing: ParsedShooter[] = [];
  for (const s of unique) {
    const key = shooterCacheKey(s);

    // Match por número de socio gana sobre match por nombre.
    const num = s.memberNumber?.trim();
    if (num) {
      const byNumber = dbByMemberNumber.get(num);
      if (byNumber) {
        cache.set(key, byNumber);
        continue;
      }
    }

    const candidates = dbByKey.get(key);
    if (!candidates || candidates.length === 0) {
      missing.push(s);
      continue;
    }
    candidates.sort((a, b) => {
      if (a.linked !== b.linked) return a.linked ? -1 : 1;
      return a.createdAt.localeCompare(b.createdAt);
    });
    cache.set(key, candidates[0]!.id);
  }

  // Paso 4: fallback per-row para los misses. Usa ilike (recupera
  // case-variants) y crea si no existe.
  for (const s of missing) {
    const id = await findOrCreateShooter(supabase, s);
    cache.set(shooterCacheKey(s), id);
  }

  return cache;
}

async function findOrCreateShooter(
  supabase: TypedSupabaseClient,
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
    is_absent: entry.isAbsent,
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
  /**
   * Estado actual del `min_shots` del match en DB. Lo usamos en re-uploads
   * y stage imports para decidir si aplicar el valor que vino en el form:
   * solo lo seteamos cuando todavía es null, así no pisamos un valor que
   * el usuario haya corregido a mano desde la página del match.
   */
  min_shots: number | null;
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
  supabase: TypedSupabaseClient,
  disciplineId: number,
  name: string,
  date: string,
  importerUserId: string,
): Promise<MatchLookupRow | null> {
  const { data } = await supabase
    .from("matches")
    .select("id, name, imported_by_user_id, min_shots, imported_at")
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
