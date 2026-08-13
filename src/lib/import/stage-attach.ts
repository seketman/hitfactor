import type { TypedSupabaseClient } from "../supabase/types";
import type { ParsedMatch, ParsedStageResult } from "@/lib/types/match";
import { shooterNameKey } from "../names";
import { ImportError } from "./import-error";
import { requireDivision } from "./helpers";

// ---------------------------------------------------------------------------
// Stages attachment (compartido entre Steel match overall e IPSC stage import)
// ---------------------------------------------------------------------------

export async function attachStagesToMatch(
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

  const { stageIdByNumber, stagesCount } = await bulkResolveStages(
    supabase,
    matchId,
    stagesWithNumber,
  );

  const { entryByNameDiv, entriesByName } = await buildEntryByNameIndex(
    supabase,
    matchId,
  );

  // -- 3. Loop sin round-trips: armamos un único batch con TODOS los
  //       stage_results y hacemos un solo upsert al final.
  const stageResultRows: ReturnType<typeof mapStageResultToRow>[] = [];
  for (const stage of stagesWithNumber) {
    const stageId = stageIdByNumber.get(stage.stageNumber);
    if (!stageId) continue; // no debería pasar tras paso 1
    for (const result of stage.results) {
      const divisionId = requireDivision(divisionByCode, result.divisionCode);
      const normName = shooterNameKey(result.shooter.fullName);

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
    throw new ImportError(
      "STAGE_RESULTS_INSERT_FAILED",
      undefined,
      resErr.message,
    );
  }
  return { stagesCount, resultsCount: stageResultRows.length };
}

/**
 * -- 1. Resolución bulk de stages (1 SELECT + opcionalmente 1 INSERT
 *       en lugar de N round-trips, uno por stage).
 */
async function bulkResolveStages(
  supabase: TypedSupabaseClient,
  matchId: string,
  stagesWithNumber: Array<{ stageNumber: number; name: string }>,
): Promise<{ stageIdByNumber: Map<number, string>; stagesCount: number }> {
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
      throw new ImportError(
        "STAGE_INSERT_FAILED",
        undefined,
        stageErr.message,
      );
    }
    for (const s of created ?? []) {
      stageIdByNumber.set(s.stage_number as number, s.id as string);
    }
    stagesCount = newStageRows.length;
  }
  return { stageIdByNumber, stagesCount };
}

/**
 * -- 2. Resolución bulk de match_entries POR NOMBRE + DIVISIÓN.
 *
 *       Antes resolvíamos shooterId vía `resolveShootersBulk` y después
 *       lookupeábamos match_entry por (shooter_id, division). Pero la
 *       cache de shooters dedup-ea por `(fullName, memberNumber)` y los
 *       archivos de stages de PractiScore NO traen número de socio. Si
 *       un tirador competía en dos divisiones del mismo match con
 *       variantes de nombre que `stripNameSuffixes` colapsa (ej.
 *       "CELIZ, Martin PCC" / "CELIZ, Martin" → ambos a "CELIZ, Martin"),
 *       ambos parsed stage results recibían el MISMO shooterId. El
 *       fallback "1 entry única" mandaba ambos al mismo match_entry_id
 *       y el upsert pegaba con `ON CONFLICT DO UPDATE command cannot
 *       affect row a second time`.
 *
 *       Fix: lookupear el match_entry directamente por (nombre
 *       normalizado, división). Eso elimina el shooterId como
 *       intermediario y garantiza que cada parsed stage result va al
 *       match_entry de su división correcta.
 */
async function buildEntryByNameIndex(
  supabase: TypedSupabaseClient,
  matchId: string,
): Promise<{
  entryByNameDiv: Map<string, string>;
  entriesByName: Map<string, string[]>;
}> {
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
    const normName = shooterNameKey(fullName);
    const entryId = e.id as string;
    entryByNameDiv.set(`${normName}|${e.division_id}`, entryId);
    const arr = entriesByName.get(normName) ?? [];
    arr.push(entryId);
    entriesByName.set(normName, arr);
  }

  return { entryByNameDiv, entriesByName };
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
