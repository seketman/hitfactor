import { describe, expect, it } from "vitest";
import { computeShooterStats } from "@/lib/stats/shooter-stats";
import type { MyEntryRow } from "@/lib/db/types";

/**
 * Helper para fabricar entries con valores razonables por defecto.
 */
function entry(overrides: Partial<EntryInput> = {}): MyEntryRow {
  const e: EntryInput = {
    id: "e1",
    matchId: "m1",
    matchName: "Match 1",
    date: "2026-01-01",
    place: 1,
    matchPercentage: 100,
    hits: null,
    isDq: false,
    divisionCode: "PR",
    divisionName: "Production",
    disciplineCode: "TP",
    disciplineName: "Tiro Práctico",
    ...overrides,
  };
  return {
    id: e.id,
    place: e.place,
    match_points: 0,
    match_percentage: e.matchPercentage,
    total_time_seconds: null,
    hits: e.hits,
    is_dq: e.isDq,
    power_factor: null,
    category: null,
    divisions: { code: e.divisionCode, name: e.divisionName },
    matches: {
      id: e.matchId,
      name: e.matchName,
      date: e.date,
      region: null,
      disciplines: { code: e.disciplineCode, name: e.disciplineName },
    },
  };
}

interface EntryInput {
  id: string;
  matchId: string;
  matchName: string;
  date: string;
  place: number;
  matchPercentage: number;
  hits: number | null;
  isDq: boolean;
  divisionCode: string;
  divisionName: string;
  disciplineCode: string;
  disciplineName: string;
}

describe("computeShooterStats — casos vacíos", () => {
  it("devuelve ceros y nulls cuando no hay entries", () => {
    const s = computeShooterStats([]);
    expect(s.totalMatches).toBe(0);
    expect(s.scoredMatches).toBe(0);
    expect(s.avgPercentage).toBe(0);
    expect(s.bestPercentage).toBeNull();
    expect(s.bestPlace).toBeNull();
    expect(s.avgPercentile).toBeNull();
    expect(s.bestPercentile).toBeNull();
    expect(s.consistency).toBeNull();
    expect(s.trajectorySlope).toBeNull();
    expect(s.cadence).toBeNull();
    expect(s.topDiscipline).toBeNull();
    expect(s.topDivision).toBeNull();
    expect(s.byDiscipline).toEqual([]);
    expect(s.timeline).toEqual([]);
  });

  it("ignora entries sin match embebido", () => {
    const e = entry();
    e.matches = null;
    const s = computeShooterStats([e]);
    expect(s.totalMatches).toBe(0);
    expect(s.timeline).toEqual([]);
  });
});

describe("computeShooterStats — un solo entry", () => {
  it("calcula KPIs básicos sin tendencia ni consistencia", () => {
    const s = computeShooterStats([
      entry({ matchPercentage: 75, place: 5 }),
    ]);
    expect(s.totalMatches).toBe(1);
    expect(s.scoredMatches).toBe(1);
    expect(s.avgPercentage).toBe(75);
    expect(s.bestPercentage?.value).toBe(75);
    expect(s.bestPlace?.value).toBe(5);
    expect(s.trajectorySlope).toBeNull();
    expect(s.consistency).toBeNull();
  });
});

describe("computeShooterStats — exclusión de DQ", () => {
  it("DQ cuenta en totalMatches pero no en promedios", () => {
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", matchPercentage: 80, place: 2 }),
      entry({ id: "b", matchId: "mb", matchPercentage: 0, place: 99, isDq: true }),
    ]);
    expect(s.totalMatches).toBe(2);
    expect(s.scoredMatches).toBe(1);
    expect(s.avgPercentage).toBe(80);
    expect(s.bestPercentage?.matchId).toBe("ma");
    expect(s.bestPlace?.matchId).toBe("ma");
  });

  it("retorna null si todos los entries son DQ", () => {
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", isDq: true, matchPercentage: 0, place: 50 }),
    ]);
    expect(s.scoredMatches).toBe(0);
    expect(s.avgPercentage).toBe(0);
    expect(s.bestPercentage).toBeNull();
    expect(s.bestPlace).toBeNull();
  });
});

describe("computeShooterStats — bestPercentage / bestPlace", () => {
  it("identifica el mayor matchPercentage", () => {
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", matchPercentage: 60 }),
      entry({ id: "b", matchId: "mb", date: "2026-02-01", matchPercentage: 95 }),
      entry({ id: "c", matchId: "mc", date: "2026-03-01", matchPercentage: 80 }),
    ]);
    expect(s.bestPercentage?.matchId).toBe("mb");
    expect(s.bestPercentage?.value).toBe(95);
  });

  it("identifica el menor place (mejor puesto)", () => {
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", place: 5 }),
      entry({ id: "b", matchId: "mb", date: "2026-02-01", place: 1 }),
      entry({ id: "c", matchId: "mc", date: "2026-03-01", place: 10 }),
    ]);
    expect(s.bestPlace?.matchId).toBe("mb");
    expect(s.bestPlace?.value).toBe(1);
  });
});

describe("computeShooterStats — trajectorySlope (regresión lineal)", () => {
  it("null si hay menos de 2 matches válidos", () => {
    const s = computeShooterStats([entry({ matchPercentage: 50 })]);
    expect(s.trajectorySlope).toBeNull();
  });

  it("pendiente positiva cuando mejorás linealmente", () => {
    // y = 60, 70, 80 → +10 por torneo
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", date: "2026-01-01", matchPercentage: 60 }),
      entry({ id: "b", matchId: "mb", date: "2026-02-01", matchPercentage: 70 }),
      entry({ id: "c", matchId: "mc", date: "2026-03-01", matchPercentage: 80 }),
    ]);
    expect(s.trajectorySlope).toBeCloseTo(10, 6);
  });

  it("pendiente negativa cuando empeorás", () => {
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", date: "2026-01-01", matchPercentage: 90 }),
      entry({ id: "b", matchId: "mb", date: "2026-02-01", matchPercentage: 80 }),
      entry({ id: "c", matchId: "mc", date: "2026-03-01", matchPercentage: 70 }),
    ]);
    expect(s.trajectorySlope).toBeCloseTo(-10, 6);
  });

  it("pendiente ~0 si el rendimiento se mantiene", () => {
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", date: "2026-01-01", matchPercentage: 75 }),
      entry({ id: "b", matchId: "mb", date: "2026-02-01", matchPercentage: 76 }),
      entry({ id: "c", matchId: "mc", date: "2026-03-01", matchPercentage: 74 }),
      entry({ id: "d", matchId: "md", date: "2026-04-01", matchPercentage: 75 }),
    ]);
    expect(s.trajectorySlope).not.toBeNull();
    expect(Math.abs(s.trajectorySlope!)).toBeLessThan(1);
  });
});

describe("computeShooterStats — consistencia", () => {
  it("null con menos de 2 matches válidos", () => {
    expect(computeShooterStats([]).consistency).toBeNull();
    expect(
      computeShooterStats([entry({ matchPercentage: 80 })]).consistency,
    ).toBeNull();
  });

  it("baja cuando los puntajes son parecidos", () => {
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", date: "2026-01-01", matchPercentage: 70 }),
      entry({ id: "b", matchId: "mb", date: "2026-02-01", matchPercentage: 71 }),
      entry({ id: "c", matchId: "mc", date: "2026-03-01", matchPercentage: 69 }),
    ]);
    expect(s.consistency).not.toBeNull();
    expect(s.consistency!).toBeLessThan(2);
  });

  it("alta cuando hay mucha varianza", () => {
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", date: "2026-01-01", matchPercentage: 30 }),
      entry({ id: "b", matchId: "mb", date: "2026-02-01", matchPercentage: 90 }),
      entry({ id: "c", matchId: "mc", date: "2026-03-01", matchPercentage: 50 }),
    ]);
    expect(s.consistency).not.toBeNull();
    expect(s.consistency!).toBeGreaterThan(20);
  });
});

describe("computeShooterStats — percentil", () => {
  it("null si no se proveen tamaños de división", () => {
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", divisionCode: "P", place: 5 }),
    ]);
    expect(s.avgPercentile).toBeNull();
    expect(s.bestPercentile).toBeNull();
  });

  it("computa percentil = place / total × 100 por match", () => {
    const sizes = new Map<string, number>([
      ["ma|P", 10], // #5 de 10 → percentil 50
      ["mb|P", 20], // #2 de 20 → percentil 10
    ]);
    const s = computeShooterStats(
      [
        entry({ id: "a", matchId: "ma", divisionCode: "P", place: 5 }),
        entry({
          id: "b",
          matchId: "mb",
          date: "2026-02-01",
          divisionCode: "P",
          place: 2,
        }),
      ],
      { divisionSizes: sizes },
    );
    expect(s.avgPercentile).toBeCloseTo(30, 6);
    expect(s.bestPercentile?.value).toBeCloseTo(10, 6);
    expect(s.bestPercentile?.matchId).toBe("mb");
  });

  it("ignora matches sin tamaño conocido para promediar", () => {
    const sizes = new Map<string, number>([["ma|P", 10]]);
    const s = computeShooterStats(
      [
        entry({ id: "a", matchId: "ma", divisionCode: "P", place: 1 }),
        entry({
          id: "b",
          matchId: "mb",
          date: "2026-02-01",
          divisionCode: "P",
          place: 5,
        }),
      ],
      { divisionSizes: sizes },
    );
    // Solo "ma" cuenta: #1 de 10 = 10
    expect(s.avgPercentile).toBeCloseTo(10, 6);
  });

  it("excluye DQs del promedio de percentiles", () => {
    const sizes = new Map<string, number>([
      ["ma|P", 10],
      ["mb|P", 10],
    ]);
    const s = computeShooterStats(
      [
        entry({ id: "a", matchId: "ma", divisionCode: "P", place: 1 }),
        entry({
          id: "b",
          matchId: "mb",
          date: "2026-02-01",
          divisionCode: "P",
          place: 99,
          isDq: true,
        }),
      ],
      { divisionSizes: sizes },
    );
    expect(s.avgPercentile).toBeCloseTo(10, 6);
  });
});

describe("computeShooterStats — cadencia", () => {
  const NOW = new Date("2026-05-01T00:00:00Z");

  it("null cuando no hay matches", () => {
    expect(computeShooterStats([], { now: NOW }).cadence).toBeNull();
  });

  it("cuenta días desde el último match", () => {
    const s = computeShooterStats(
      [entry({ id: "a", matchId: "ma", date: "2026-04-21" })],
      { now: NOW },
    );
    expect(s.cadence?.daysSinceLastMatch).toBe(10);
  });

  it("matchesPerMonth = (matches en últimos 90d / 90) × 30", () => {
    // 3 matches dentro de los últimos 90 días → 1.0/mes
    const s = computeShooterStats(
      [
        entry({ id: "a", matchId: "ma", date: "2026-04-01" }),
        entry({ id: "b", matchId: "mb", date: "2026-03-01" }),
        entry({ id: "c", matchId: "mc", date: "2026-02-15" }),
      ],
      { now: NOW },
    );
    expect(s.cadence?.matchesPerMonth).toBeCloseTo(1, 6);
  });

  it("excluye matches fuera de la ventana de 90 días", () => {
    const s = computeShooterStats(
      [
        entry({ id: "old", matchId: "ma", date: "2025-01-01" }),
        entry({ id: "new", matchId: "mb", date: "2026-04-15" }),
      ],
      { now: NOW },
    );
    // Solo el reciente cuenta para cadencia.
    expect(s.cadence?.matchesPerMonth).toBeCloseTo(1 / 3, 4);
  });
});

describe("computeShooterStats — agregación por disciplina y división", () => {
  it("topDiscipline ordena por count descendente", () => {
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", date: "2026-01-01", disciplineCode: "TP", disciplineName: "Tiro Práctico", matchPercentage: 80 }),
      entry({ id: "b", matchId: "mb", date: "2026-02-01", disciplineCode: "TP", disciplineName: "Tiro Práctico", matchPercentage: 60 }),
      entry({ id: "c", matchId: "mc", date: "2026-03-01", disciplineCode: "SC", disciplineName: "Steel Challenge", matchPercentage: 90 }),
    ]);
    expect(s.topDiscipline?.code).toBe("TP");
    expect(s.topDiscipline?.count).toBe(2);
    expect(s.topDiscipline?.avgPercentage).toBe(70);
    expect(s.topDiscipline?.bestPercentage).toBe(80);
    expect(s.byDiscipline).toHaveLength(2);
    expect(s.byDiscipline[1]?.code).toBe("SC");
  });

  it("topDivision toma la división con más participaciones", () => {
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", date: "2026-01-01", divisionCode: "PR", divisionName: "Production" }),
      entry({ id: "b", matchId: "mb", date: "2026-02-01", divisionCode: "PR", divisionName: "Production" }),
      entry({ id: "c", matchId: "mc", date: "2026-03-01", divisionCode: "OP", divisionName: "Open" }),
    ]);
    expect(s.topDivision?.code).toBe("PR");
    expect(s.topDivision?.count).toBe(2);
  });
});

describe("computeShooterStats — timeline", () => {
  it("ordena por fecha ascendente", () => {
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", date: "2026-03-15" }),
      entry({ id: "b", matchId: "mb", date: "2026-01-10" }),
      entry({ id: "c", matchId: "mc", date: "2026-02-20" }),
    ]);
    expect(s.timeline.map((p) => p.matchId)).toEqual(["mb", "mc", "ma"]);
  });

  it("incluye los DQ en la timeline", () => {
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", date: "2026-01-01", isDq: true }),
      entry({ id: "b", matchId: "mb", date: "2026-02-01" }),
    ]);
    expect(s.timeline).toHaveLength(2);
    expect(s.timeline[0]?.isDq).toBe(true);
  });
});

describe("computeShooterStats — impactos (FBI)", () => {
  it("null para avgHits/bestHits cuando ningún entry tiene hits", () => {
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", date: "2026-01-01", hits: null }),
      entry({ id: "b", matchId: "mb", date: "2026-02-01", hits: null }),
    ]);
    expect(s.avgHits).toBeNull();
    expect(s.bestHits).toBeNull();
  });

  it("computa avgHits sobre entries con hits != null", () => {
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", date: "2026-01-01", hits: 30 }),
      entry({ id: "b", matchId: "mb", date: "2026-02-01", hits: 38 }),
      entry({ id: "c", matchId: "mc", date: "2026-03-01", hits: 40 }),
    ]);
    expect(s.avgHits).toBeCloseTo(36, 5);
    expect(s.bestHits?.value).toBe(40);
    expect(s.bestHits?.matchId).toBe("mc");
  });

  it("ignora DQs al computar avgHits/bestHits", () => {
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", date: "2026-01-01", hits: 40, isDq: true }),
      entry({ id: "b", matchId: "mb", date: "2026-02-01", hits: 35 }),
    ]);
    // DQ aporta 40 hits, pero se excluye → avg = 35.
    expect(s.avgHits).toBe(35);
    expect(s.bestHits?.value).toBe(35);
  });

  it("ignora entries sin hits al promediar (mix de disciplinas)", () => {
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", date: "2026-01-01", hits: null }), // IPSC
      entry({ id: "b", matchId: "mb", date: "2026-02-01", hits: 36 }), // FBI
      entry({ id: "c", matchId: "mc", date: "2026-03-01", hits: 40 }), // FBI
    ]);
    expect(s.avgHits).toBe(38);
    expect(s.bestHits?.value).toBe(40);
  });
});
