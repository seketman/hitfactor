import type { MyEntryRow, MyStageRow } from "../db/types";

/**
 * Estadísticas agregadas de un tirador a partir de su historial completo
 * (resultados en match_entries).
 *
 * Pure function: recibe los entries (y datos auxiliares) y devuelve los KPIs.
 * No hace queries.
 */

export interface MatchTimelinePoint {
  matchId: string;
  matchName: string;
  date: string;
  matchPercentage: number;
  place: number;
  /** Total de tiradores en mi división de ese match (null si no se conoce). */
  totalInDivision: number | null;
  /**
   * Percentil dentro de la división: place/total × 100. Más bajo = mejor.
   * Null si no se conoce el total.
   */
  percentile: number | null;
  /**
   * Impactos del tirador en el match. Sólo poblado para disciplinas hits-based
   * (Tiro FBI: 0..40). Null en IPSC y Steel.
   */
  hits: number | null;
  divisionCode: string;
  divisionName: string;
  disciplineCode: string;
  disciplineName: string;
  isDq: boolean;
}

export interface MatchHighlight {
  matchId: string;
  matchName: string;
  date: string;
  value: number;
  divisionCode: string;
}

export interface DisciplineBreakdown {
  code: string;
  name: string;
  count: number;
  avgPercentage: number;
  bestPercentage: number;
}

export interface DivisionBreakdown {
  code: string;
  name: string;
  count: number;
  avgPercentage: number;
}

export interface CadenceStats {
  /** Torneos por mes en los últimos 90 días. */
  matchesPerMonth: number;
  /** Días desde el match más reciente. Null si no hay matches. */
  daysSinceLastMatch: number | null;
}

/**
 * KPIs agregados cross-matches a nivel de stage. Computados sobre
 * stage_results no-DQ del usuario. Null si no hay datos suficientes.
 */
export interface StageStats {
  /** Total de stages contabilizados (no-DQ). */
  scoredStages: number;
  /** % de stages ganados (place === 1). 0-100. */
  winRate: number;
  /** % de stages en podio (place 1..3). 0-100. */
  podiumRate: number;
  /**
   * % de stages con al menos una penalty (penalties > 0). Null si no hay
   * datos de penalties (FBI y Steel no las registran).
   */
  penaltyRate: number | null;
  /** Mejor stage_percentage registrado. 0 si no hay datos. */
  bestStagePercentage: number;
}

export interface ShooterStats {
  /** Total de torneos disputados (incluye DQ). */
  totalMatches: number;
  /** Total considerados para promedios (excluye DQ). */
  scoredMatches: number;
  /** Promedio de Match % en torneos válidos. 0 si no hay. */
  avgPercentage: number;
  /** Tu mejor Match %. null si no hay. */
  bestPercentage: MatchHighlight | null;
  /** Tu mejor puesto (numéricamente más bajo). null si no hay. */
  bestPlace: MatchHighlight | null;
  /**
   * Promedio de impactos en torneos válidos donde hits != null (Tiro FBI).
   * Null si no hay matches con hits.
   */
  avgHits: number | null;
  /** Tu mejor cantidad de impactos. Null si no hay matches con hits. */
  bestHits: MatchHighlight | null;
  /**
   * Desvío estándar muestral de impactos en matches con hits.
   * Null si hay menos de 2 matches con hits.
   */
  consistencyHits: number | null;
  /**
   * Pendiente de la regresión lineal de impactos vs orden cronológico,
   * en "impactos por torneo". Null si <2 matches con hits.
   */
  trajectoryHitsSlope: number | null;
  /**
   * Percentil promedio dentro de tu división (place/total × 100).
   * Más bajo = mejor (top 10% > top 30%). Null si no hay datos de tamaño.
   */
  avgPercentile: number | null;
  /** Tu mejor percentil — el más bajo registrado. Null si no hay datos. */
  bestPercentile: MatchHighlight | null;
  /**
   * Consistencia: desvío estándar muestral del Match % en torneos válidos.
   * Menor = más predecible. Null si hay menos de 2 matches válidos.
   */
  consistency: number | null;
  /**
   * Pendiente de la regresión lineal de Match % vs orden cronológico,
   * en unidades de "% por torneo". Positivo = mejorando. Null si <2 puntos.
   */
  trajectorySlope: number | null;
  /** Cadencia reciente. Null si no hay matches. */
  cadence: CadenceStats | null;
  /**
   * KPIs por stage agregados sobre el historial. Null si no hay stage_results
   * (típico cuando los matches importados son solo overall sin stages).
   */
  stageStats: StageStats | null;
  /** Disciplina con más participaciones. */
  topDiscipline: DisciplineBreakdown | null;
  /** División con más participaciones. */
  topDivision: DivisionBreakdown | null;
  /** Resumen por disciplina (para tabs/filtros). */
  byDiscipline: DisciplineBreakdown[];
  /** Línea temporal ascendente por fecha — apta para graficar. */
  timeline: MatchTimelinePoint[];
}

export interface ComputeShooterStatsOptions {
  /**
   * Map con la cantidad de tiradores que compitieron en cada (match, división).
   * Clave: `${matchId}|${divisionCode}`. Si falta la entrada para un match,
   * los percentiles de ese match quedan en null.
   */
  divisionSizes?: Map<string, number>;
  /** Fecha "ahora" para cómputo de cadencia (testabilidad). */
  now?: Date;
  /**
   * Stage results del usuario para los matches incluidos en `entries`.
   * Si no se pasa, `stageStats` queda en null.
   */
  stageResults?: MyStageRow[];
}

const CADENCE_WINDOW_DAYS = 90;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function computeShooterStats(
  entries: MyEntryRow[],
  options: ComputeShooterStatsOptions = {},
): ShooterStats {
  const allPoints = toTimelinePoints(entries, options.divisionSizes).sort(
    (a, b) => a.date.localeCompare(b.date),
  );

  // Dedup por match: si un tirador corrió 2+ divisiones en el mismo torneo
  // (ej. PO y PCCO el mismo día), cuenta como UN torneo en las KPIs
  // cross-match. Política de selección por match: preferimos non-DQ y luego
  // el `matchPercentage` más alto — su mejor desempeño del día representa
  // al match en la línea temporal y en los promedios.
  //
  // El usuario puede inspeccionar cada participación por separado vía el
  // filtro de división del dashboard (`?division=XX`); en ese caso los
  // entries que llegan ya están filtrados a una sola división y este dedup
  // queda como no-op.
  //
  // `byDivision` sigue armándose sobre TODOS los entries (sin dedup) — ese
  // desglose precisamente quiere ver cada división por separado.
  const points = dedupByMatch(allPoints);

  const scored = points.filter((p) => !p.isDq);
  const scoredMatches = scored.length;

  const avgPercentage =
    scoredMatches > 0
      ? scored.reduce((acc, p) => acc + p.matchPercentage, 0) / scoredMatches
      : 0;

  const bestPercentage = scored.length
    ? scored.reduce((best, p) =>
        p.matchPercentage > best.matchPercentage ? p : best,
      )
    : null;

  const bestPlace = scored.length
    ? scored.reduce((best, p) => (p.place < best.place ? p : best))
    : null;

  // Stats de impactos: solo sobre puntos con hits != null (FBI).
  const withHits = scored.filter(
    (p): p is MatchTimelinePoint & { hits: number } => p.hits !== null,
  );
  const avgHits =
    withHits.length > 0
      ? withHits.reduce((a, p) => a + p.hits, 0) / withHits.length
      : null;
  const bestHitsPoint = withHits.length
    ? withHits.reduce((best, p) => (p.hits > best.hits ? p : best))
    : null;
  const consistencyHits = standardDeviation(withHits.map((p) => p.hits));
  const trajectoryHitsSlope = linearRegressionSlope(
    withHits.map((p, i) => ({ x: i, y: p.hits })),
  );

  // Percentiles: solo sobre matches con totalInDivision conocido.
  const withPercentile = scored.filter(
    (p): p is MatchTimelinePoint & { percentile: number } => p.percentile !== null,
  );
  const avgPercentile =
    withPercentile.length > 0
      ? withPercentile.reduce((a, p) => a + p.percentile, 0) /
        withPercentile.length
      : null;
  const bestPercentilePoint = withPercentile.length
    ? withPercentile.reduce((best, p) => (p.percentile < best.percentile ? p : best))
    : null;

  const consistency = standardDeviation(scored.map((p) => p.matchPercentage));
  const trajectorySlope = linearRegressionSlope(
    scored.map((p, i) => ({ x: i, y: p.matchPercentage })),
  );

  const now = options.now ?? new Date();
  const cadence = computeCadence(points, now);
  const stageStats = computeStageStats(options.stageResults);

  // `byDiscipline` cuenta torneos únicos por disciplina → usa el set deduped.
  // `byDivision` muestra el desglose por división → usa todos los entries
  // (un mismo torneo aparece en PO y PCCO si el tirador corrió ambas).
  const allScored = allPoints.filter((p) => !p.isDq);
  const byDiscipline = aggregateByDiscipline(scored);
  const byDivision = aggregateByDivision(allScored);

  return {
    totalMatches: points.length,
    scoredMatches,
    avgPercentage,
    bestPercentage: bestPercentage
      ? {
          matchId: bestPercentage.matchId,
          matchName: bestPercentage.matchName,
          date: bestPercentage.date,
          value: bestPercentage.matchPercentage,
          divisionCode: bestPercentage.divisionCode,
        }
      : null,
    bestPlace: bestPlace
      ? {
          matchId: bestPlace.matchId,
          matchName: bestPlace.matchName,
          date: bestPlace.date,
          value: bestPlace.place,
          divisionCode: bestPlace.divisionCode,
        }
      : null,
    avgHits,
    bestHits: bestHitsPoint
      ? {
          matchId: bestHitsPoint.matchId,
          matchName: bestHitsPoint.matchName,
          date: bestHitsPoint.date,
          value: bestHitsPoint.hits,
          divisionCode: bestHitsPoint.divisionCode,
        }
      : null,
    consistencyHits,
    trajectoryHitsSlope,
    avgPercentile,
    bestPercentile: bestPercentilePoint
      ? {
          matchId: bestPercentilePoint.matchId,
          matchName: bestPercentilePoint.matchName,
          date: bestPercentilePoint.date,
          value: bestPercentilePoint.percentile,
          divisionCode: bestPercentilePoint.divisionCode,
        }
      : null,
    consistency,
    trajectorySlope,
    cadence,
    stageStats,
    topDiscipline: byDiscipline[0] ?? null,
    topDivision: byDivision[0] ?? null,
    byDiscipline,
    timeline: points,
  };
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Reduce una lista de puntos a uno por match. Política:
 *  1. Si hay un entry non-DQ y otro DQ para el mismo match, gana el non-DQ
 *     (el DQ no debería borrar la participación válida).
 *  2. Empate (ambos non-DQ o ambos DQ): gana el `matchPercentage` más alto.
 *
 * Preserva el orden del input (ya viene sorted por fecha).
 */
function dedupByMatch(points: MatchTimelinePoint[]): MatchTimelinePoint[] {
  const chosen = new Map<string, MatchTimelinePoint>();
  for (const p of points) {
    const current = chosen.get(p.matchId);
    if (!current) {
      chosen.set(p.matchId, p);
      continue;
    }
    if (current.isDq && !p.isDq) {
      chosen.set(p.matchId, p);
      continue;
    }
    if (!current.isDq && p.isDq) continue;
    if (p.matchPercentage > current.matchPercentage) {
      chosen.set(p.matchId, p);
    }
  }
  // Filtramos preservando el orden original: para cada matchId queda solo
  // la referencia elegida.
  return points.filter((p) => chosen.get(p.matchId) === p);
}

function toTimelinePoints(
  entries: MyEntryRow[],
  divisionSizes: Map<string, number> | undefined,
): MatchTimelinePoint[] {
  const out: MatchTimelinePoint[] = [];
  for (const e of entries) {
    if (!e.matches) continue;
    const divisionCode = e.divisions?.code ?? "";
    const total = divisionSizes?.get(`${e.matches.id}|${divisionCode}`) ?? null;
    const percentile = total && total > 0 ? (e.place / total) * 100 : null;

    out.push({
      matchId: e.matches.id,
      matchName: e.matches.name,
      date: e.matches.date,
      matchPercentage: Number(e.match_percentage),
      place: e.place,
      totalInDivision: total,
      percentile,
      hits: e.hits,
      divisionCode,
      divisionName: e.divisions?.name ?? "",
      disciplineCode: e.matches.disciplines?.code ?? "",
      disciplineName: e.matches.disciplines?.name ?? "",
      isDq: e.is_dq,
    });
  }
  return out;
}

/** Desvío estándar muestral. Null si hay menos de 2 valores. */
function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  const variance =
    values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Pendiente (β) de y = α + βx por mínimos cuadrados.
 * Null si hay menos de 2 puntos o si todos los x son iguales.
 */
function linearRegressionSlope(
  points: Array<{ x: number; y: number }>,
): number | null {
  if (points.length < 2) return null;
  const meanX = points.reduce((a, p) => a + p.x, 0) / points.length;
  const meanY = points.reduce((a, p) => a + p.y, 0) / points.length;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - meanX) * (p.y - meanY);
    den += (p.x - meanX) ** 2;
  }
  if (den === 0) return null;
  return num / den;
}

function computeCadence(
  points: MatchTimelinePoint[],
  now: Date,
): CadenceStats | null {
  if (points.length === 0) return null;

  const lastDate = parseIsoDate(points[points.length - 1]!.date);
  const daysSinceLastMatch = lastDate
    ? Math.max(0, Math.floor((now.getTime() - lastDate.getTime()) / MS_PER_DAY))
    : null;

  // Matches en los últimos N días (inclusive de hoy).
  const cutoff = now.getTime() - CADENCE_WINDOW_DAYS * MS_PER_DAY;
  let recentCount = 0;
  for (const p of points) {
    const d = parseIsoDate(p.date);
    if (d && d.getTime() >= cutoff) recentCount++;
  }
  const matchesPerMonth = (recentCount / CADENCE_WINDOW_DAYS) * 30;

  return { matchesPerMonth, daysSinceLastMatch };
}

/**
 * Agrega KPIs cross-matches sobre stage_results. Filtra DQs y stages sin
 * place (sucede ocasionalmente con datos parciales).
 *
 * `penaltyRate` es null cuando ningún stage del usuario tiene penalties
 * registrados — caso normal para FBI y Steel.
 */
function computeStageStats(
  rows: MyStageRow[] | undefined,
): StageStats | null {
  if (!rows || rows.length === 0) return null;
  const scored = rows.filter((r) => !r.is_dq && r.place !== null);
  if (scored.length === 0) return null;

  let wins = 0;
  let podiums = 0;
  let bestPct = 0;
  for (const r of scored) {
    if (r.place === 1) wins++;
    if (r.place !== null && r.place <= 3) podiums++;
    if (r.stage_percentage > bestPct) bestPct = r.stage_percentage;
  }

  // Penalty rate: solo computamos si al menos algún stage tiene penalties
  // no-null. En caso contrario (FBI/Steel) devolvemos null.
  const withPenaltyData = scored.filter((r) => r.penalties !== null);
  const penaltyRate =
    withPenaltyData.length > 0
      ? (withPenaltyData.filter((r) => Number(r.penalties) > 0).length /
          withPenaltyData.length) *
        100
      : null;

  return {
    scoredStages: scored.length,
    winRate: (wins / scored.length) * 100,
    podiumRate: (podiums / scored.length) * 100,
    penaltyRate,
    bestStagePercentage: bestPct,
  };
}

function parseIsoDate(iso: string): Date | null {
  // YYYY-MM-DD a UTC midnight (evita timezone shifts).
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function aggregateByDiscipline(
  points: MatchTimelinePoint[],
): DisciplineBreakdown[] {
  const buckets = new Map<
    string,
    { code: string; name: string; sum: number; best: number; count: number }
  >();
  for (const p of points) {
    const key = p.disciplineCode || "unknown";
    const b = buckets.get(key);
    if (!b) {
      buckets.set(key, {
        code: p.disciplineCode,
        name: p.disciplineName,
        sum: p.matchPercentage,
        best: p.matchPercentage,
        count: 1,
      });
    } else {
      b.sum += p.matchPercentage;
      b.best = Math.max(b.best, p.matchPercentage);
      b.count += 1;
    }
  }
  return Array.from(buckets.values())
    .map((b) => ({
      code: b.code,
      name: b.name,
      count: b.count,
      avgPercentage: b.count ? b.sum / b.count : 0,
      bestPercentage: b.best,
    }))
    .sort((a, b) => b.count - a.count);
}

function aggregateByDivision(
  points: MatchTimelinePoint[],
): DivisionBreakdown[] {
  const buckets = new Map<
    string,
    { code: string; name: string; sum: number; count: number }
  >();
  for (const p of points) {
    const key = p.divisionCode || "unknown";
    const b = buckets.get(key);
    if (!b) {
      buckets.set(key, {
        code: p.divisionCode,
        name: p.divisionName,
        sum: p.matchPercentage,
        count: 1,
      });
    } else {
      b.sum += p.matchPercentage;
      b.count += 1;
    }
  }
  return Array.from(buckets.values())
    .map((b) => ({
      code: b.code,
      name: b.name,
      count: b.count,
      avgPercentage: b.count ? b.sum / b.count : 0,
    }))
    .sort((a, b) => b.count - a.count);
}
