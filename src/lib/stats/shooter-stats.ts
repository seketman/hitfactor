import type { MyEntryRow, MyStageRow } from "../db/types";
import { parseIsoDateUtc } from "../dates";

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
   * Null si no se conoce el total **o si no hay puesto asignado**
   * (`place = 0`) — sin una de las dos puntas la cuenta no significa nada.
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
  isAbsent: boolean;
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
 * Stats de eficiencia de munición del tirador (issue #75). Solo computa
 * sobre entries con ambos datos: `matches.min_shots` poblado y el
 * `match_firearm_log.rounds_fired` cargado. Si no hay entries elegibles,
 * el cálculo devuelve null (no se renderiza KPI con cero/cero).
 */
export interface AmmoEfficiencyStats {
  /** Cantidad de entries que contribuyeron al cálculo. */
  matchCount: number;
  /** Promedio de disparos extra por entry (rounds_fired - min_shots). */
  avgExtras: number;
  /** Suma total de disparos extra acumulados. */
  totalExtras: number;
  /**
   * Suma total de los `min_shots` de los entries contabilizados. Sirve
   * de denominador para colorear el KPI agregado: el tier (% extras
   * respecto al mínimo) usa `totalExtras / totalMinShots`, así normaliza
   * entre disciplinas con mínimos muy distintos (FBI 45 vs IPSC ~150).
   */
  totalMinShots: number;
}

/**
 * Tier visual de "disparos extra" en función del % sobre el mínimo.
 * Decidimos con el usuario:
 *   - 0 disparos extra → "perfect" (verde, vale la pena celebrarlo).
 *   - (0%, 5%]         → "neutral" (1-2 disparos en 45 es ruido normal).
 *   - (5%, 15%]        → "warning" (amber — vale la pena mirar).
 *   - > 15%            → "danger"  (rojo — algo claramente fuera de lo
 *                        habitual, muchas fallas o muchos repasos).
 *
 * Lo computamos en % y no en absoluto para que un IPSC de 150 disparos
 * con +7 extras (4.6%) no aparezca peor que un FBI con +3 (6.6%).
 *
 * Negativos (rounds_fired < min_shots, físicamente raro pero posible
 * cuando un tirador subreporta) caen en "neutral" — no son una eficiencia
 * mejor que cero ni un error: son dato del usuario y los respetamos sin
 * pintarlos.
 */
export type AmmoExtrasTier = "perfect" | "neutral" | "warning" | "danger";

export function getAmmoExtrasTier(
  extras: number,
  minShots: number,
): AmmoExtrasTier {
  if (extras === 0) return "perfect";
  if (extras < 0 || minShots <= 0) return "neutral";
  const pct = (extras / minShots) * 100;
  if (pct <= 5) return "neutral";
  if (pct <= 15) return "warning";
  return "danger";
}

/**
 * KPIs agregados cross-matches a nivel de stage. Computados sobre
 * stage_results no-DQ del usuario. Null si no hay datos suficientes.
 */
export interface StageStats {
  /** Total de stages contabilizados (no-DQ). */
  scoredStages: number;
  /**
   * % de stages ganados (place === 1). 0-100.
   *
   * Sobre los stages **con puesto asignado**, que puede ser menos que
   * `scoredStages`: un stage sin posición no se gana ni se pierde, así que
   * no entra al denominador.
   */
  winRate: number;
  /** % de stages en podio (place 1..3), sobre los stages con puesto. 0-100. */
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
   * Eficiencia de munición agregada (issue #75). Null si ninguno de los
   * entries en scope tiene los dos datos requeridos (`min_shots` + `rounds_fired`).
   */
  ammoEfficiency: AmmoEfficiencyStats | null;
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

  // Ausentes y DQs no cuentan como participación scoreable: bajaban
  // artificialmente promedio, consistencia y trayectoria.
  const scored = points.filter((p) => !p.isDq && !p.isAbsent);
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

  /**
   * `place = 0` significa "sin puesto asignado", no "primero" (#202). El
   * filtro de arriba saca DQs y ausentes, pero un entry con datos parciales
   * —o de un formato que no trae posición— llega acá con 0 y le gana a
   * cualquier puesto real en el `reduce`. El KPI mostraba **0** como mejor
   * puesto y el `MatchHighlight` apuntaba a un torneo donde el tirador no
   * tiene posición.
   *
   * Es el mismo criterio que ya usa `isBetterEntry` en `import-match.ts`
   * para el dedup: solo `place > 0` es un puesto.
   */
  const placed = scored.filter((p) => p.place > 0);
  const bestPlace = placed.length
    ? placed.reduce((best, p) => (p.place < best.place ? p : best))
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
  // Eficiencia se computa sobre los entries crudos (no los timeline points
  // dedup-ed): un tirador que corrió Pistola y PCC del mismo FBI gastó
  // munición en ambas, así que ambos entries cuentan.
  const ammoEfficiency = computeAmmoEfficiency(entries);

  // `byDiscipline` cuenta torneos únicos por disciplina → usa el set deduped.
  // `byDivision` muestra el desglose por división → usa todos los entries
  // (un mismo torneo aparece en PO y PCCO si el tirador corrió ambas).
  const allScored = allPoints.filter((p) => !p.isDq && !p.isAbsent);
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
    ammoEfficiency,
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
 * Eficiencia de munición (issue #75). Pure function: dado el array de
 * entries del tirador, devuelve el promedio y total de disparos extra
 * sobre los matches con datos completos (`min_shots` poblado y
 * `rounds_fired` cargado).
 *
 * Decisiones:
 *  - **No dedup por match**: si el tirador corrió Pistola y PCC del mismo
 *    FBI, gastó munición en ambas entries; cuentan las dos.
 *  - **No filtramos DQ/ausentes**: si el tirador registró disparos reales
 *    los respetamos. Un DQ con armas registradas sigue siendo data válida
 *    de consumo.
 *  - **Null para N=0**: preferible esconder el tile que mostrar "0 / 0 / —".
 *    El umbral mínimo es 1 entry — incluso un solo dato es informativo
 *    aunque la UI puede agregarle un "(n=1)" para señalar muestra chica.
 */
export function computeAmmoEfficiency(
  entries: MyEntryRow[],
): AmmoEfficiencyStats | null {
  let totalExtras = 0;
  let totalMinShots = 0;
  let count = 0;
  for (const e of entries) {
    const minShots = e.matches?.min_shots;
    const roundsFired = e.match_firearm_log?.rounds_fired;
    if (minShots == null || roundsFired == null) continue;
    totalExtras += roundsFired - minShots;
    totalMinShots += minShots;
    count += 1;
  }
  if (count === 0) return null;
  return {
    matchCount: count,
    totalExtras,
    totalMinShots,
    avgExtras: totalExtras / count,
  };
}

/**
 * Reduce una lista de puntos a uno por match. Política:
 *  1. Una participación "válida" (no DQ y no ausente) gana sobre cualquier
 *     no-válida del mismo match. Cubre el caso multi-división donde alguien
 *     se anotó en dos divisiones y solo participó en una.
 *  2. Empate (ambos válidos o ambos no-válidos): gana `matchPercentage` mayor.
 *
 * Preserva el orden del input (ya viene sorted por fecha).
 */
function dedupByMatch(points: MatchTimelinePoint[]): MatchTimelinePoint[] {
  const chosen = new Map<string, MatchTimelinePoint>();
  const isValid = (p: MatchTimelinePoint) => !p.isDq && !p.isAbsent;
  for (const p of points) {
    const current = chosen.get(p.matchId);
    if (!current) {
      chosen.set(p.matchId, p);
      continue;
    }
    const curValid = isValid(current);
    const newValid = isValid(p);
    if (!curValid && newValid) {
      chosen.set(p.matchId, p);
      continue;
    }
    if (curValid && !newValid) continue;
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
    // El percentil necesita las DOS puntas conocidas. Con `place = 0` —que
    // es "sin puesto", no "primero"— la cuenta daba 0, y más bajo es mejor:
    // el peor dato posible se leía como el mejor resultado posible, y encima
    // arrastraba el promedio hacia abajo. Null es lo que ya significa "no se
    // puede calcular" acá, igual que cuando falta el total (#202).
    const percentile =
      total && total > 0 && e.place > 0 ? (e.place / total) * 100 : null;

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
      isAbsent: e.is_absent,
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
 * place — que son tanto los `null` como los `0`: el docstring decía "sin
 * place" desde antes, pero el filtro solo miraba `null` y dejaba pasar los
 * 0 (#202).
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

  /**
   * Mismo `place = 0` que en `bestPlace`, encontrado al arreglar aquél
   * (#202). Acá pegaba distinto y peor: `r.place <= 3` es verdadero para 0,
   * así que un stage **sin puesto asignado contaba como podio**. El
   * `podiumRate` de un tirador subía por stages en los que no tiene
   * posición.
   *
   * Va con denominador propio y no filtrando `scored`: un stage sin puesto
   * igual tiene `stage_percentage` y `penalties` válidos, así que sigue
   * contando para esos KPIs. Lo que no se puede es ganarlo ni perderlo, y
   * por eso no entra ni al numerador ni al denominador de win/podium.
   */
  const placed = scored.filter((r) => r.place !== null && r.place > 0);

  let wins = 0;
  let podiums = 0;
  for (const r of placed) {
    if (r.place === 1) wins++;
    if (r.place! <= 3) podiums++;
  }

  let bestPct = 0;
  for (const r of scored) {
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
    // Sin ningún stage con puesto no hay tasa que reportar: 0 de 0 es 0%,
    // no NaN.
    winRate: placed.length ? (wins / placed.length) * 100 : 0,
    podiumRate: placed.length ? (podiums / placed.length) * 100 : 0,
    penaltyRate,
    bestStagePercentage: bestPct,
  };
}

/**
 * `YYYY-MM-DD` a UTC midnight. Delega en el parser compartido, que además
 * verifica que la fecha exista: la versión local que había acá construía el
 * `Date` y lo devolvía sin chequear, así que un `2026-02-31` guardado en la
 * DB entraba al cómputo de cadencia como 3 de marzo (#201).
 */
function parseIsoDate(iso: string): Date | null {
  return parseIsoDateUtc(iso);
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
