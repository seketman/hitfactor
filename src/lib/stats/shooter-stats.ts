import type { MyEntryRow } from "../db/types";

/**
 * Estadísticas agregadas de un tirador a partir de su historial completo
 * (resultados en match_entries).
 *
 * Pure function: recibe los entries y devuelve los KPIs. No hace queries.
 */

export interface MatchTimelinePoint {
  matchId: string;
  matchName: string;
  date: string;
  matchPercentage: number;
  place: number;
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
   * Tendencia reciente: avg(últimos N) - avg(anteriores N). Positivo = mejorando.
   * null si no hay al menos 2*N torneos válidos.
   */
  trendDelta: number | null;
  /** Cuántos torneos se usaron a cada lado para `trendDelta`. */
  trendWindow: number;
  /** Disciplina con más participaciones. */
  topDiscipline: DisciplineBreakdown | null;
  /** División con más participaciones. */
  topDivision: DivisionBreakdown | null;
  /** Resumen por disciplina (para tabs/filtros). */
  byDiscipline: DisciplineBreakdown[];
  /** Línea temporal ascendente por fecha — apta para graficar. */
  timeline: MatchTimelinePoint[];
}

const TREND_WINDOW = 3;

export function computeShooterStats(entries: MyEntryRow[]): ShooterStats {
  const points = toTimelinePoints(entries).sort((a, b) =>
    a.date.localeCompare(b.date),
  );

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

  // Tendencia: tomamos los más recientes (final del array) y los anteriores.
  const trend = computeTrendDelta(scored, TREND_WINDOW);

  const byDiscipline = aggregateByDiscipline(scored);
  const byDivision = aggregateByDivision(scored);

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
    trendDelta: trend.delta,
    trendWindow: trend.window,
    topDiscipline: byDiscipline[0] ?? null,
    topDivision: byDivision[0] ?? null,
    byDiscipline,
    timeline: points,
  };
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function toTimelinePoints(entries: MyEntryRow[]): MatchTimelinePoint[] {
  const out: MatchTimelinePoint[] = [];
  for (const e of entries) {
    if (!e.matches) continue;
    out.push({
      matchId: e.matches.id,
      matchName: e.matches.name,
      date: e.matches.date,
      matchPercentage: Number(e.match_percentage),
      place: e.place,
      divisionCode: e.divisions?.code ?? "",
      divisionName: e.divisions?.name ?? "",
      disciplineCode: e.matches.disciplines?.code ?? "",
      disciplineName: e.matches.disciplines?.name ?? "",
      isDq: e.is_dq,
    });
  }
  return out;
}

function computeTrendDelta(
  points: MatchTimelinePoint[],
  desiredWindow: number,
): { delta: number | null; window: number } {
  // Necesitamos al menos 2 puntos para hacer una tendencia.
  // Si hay menos de 2*desiredWindow, achicamos la ventana al máximo posible.
  const half = Math.min(desiredWindow, Math.floor(points.length / 2));
  if (half < 1) return { delta: null, window: 0 };

  const recent = points.slice(-half);
  const previous = points.slice(-2 * half, -half);
  if (previous.length === 0) return { delta: null, window: 0 };

  const avg = (xs: MatchTimelinePoint[]) =>
    xs.reduce((a, p) => a + p.matchPercentage, 0) / xs.length;

  return { delta: avg(recent) - avg(previous), window: half };
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
