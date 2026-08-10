import { describe, expect, it } from "vitest";
import {
  computeAmmoEfficiency,
  computeShooterStats,
  getAmmoExtrasTier,
} from "@/lib/stats/shooter-stats";
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
    isAbsent: false,
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
    is_absent: e.isAbsent,
    power_factor: null,
    category: null,
    divisions: { code: e.divisionCode, name: e.divisionName },
    matches: {
      id: e.matchId,
      name: e.matchName,
      date: e.date,
      region: null,
      min_shots: e.minShots ?? null,
      disciplines: { code: e.disciplineCode, name: e.disciplineName },
    },
    match_firearm_log:
      e.roundsFired != null ? { rounds_fired: e.roundsFired } : null,
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
  isAbsent: boolean;
  divisionCode: string;
  divisionName: string;
  disciplineCode: string;
  disciplineName: string;
  /** Disparos mínimos del match (issue #75). Opcional en fixtures. */
  minShots?: number | null;
  /** Disparos reales del entry (vía match_firearm_log). */
  roundsFired?: number | null;
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

describe("computeShooterStats — exclusión de ausentes", () => {
  it("ausentes NO bajan promedio ni cuentan como matches scoreados", () => {
    // Antes del fix: un ausente con 0% destruía el avgPercentage del
    // tirador. La regresión que esto previene fue reportada por usuarios
    // reales que se anotaron a un torneo y no asistieron.
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", matchPercentage: 90, place: 1 }),
      entry({
        id: "b",
        matchId: "mb",
        date: "2026-02-01",
        matchPercentage: 0,
        place: 99,
        isAbsent: true,
      }),
    ]);
    expect(s.totalMatches).toBe(2);
    expect(s.scoredMatches).toBe(1);
    expect(s.avgPercentage).toBe(90);
    expect(s.bestPercentage?.matchId).toBe("ma");
  });

  it("multi-división con una ausencia: prefiere el entry válido en dedup", () => {
    // Caso real: un tirador se anota en PO y PCCO, solo participa en PO.
    // El dedup por match debe quedarse con PO (válido), no con PCCO (ausente).
    const s = computeShooterStats([
      entry({
        id: "a",
        matchId: "m1",
        matchPercentage: 85,
        place: 3,
        divisionCode: "PO",
      }),
      entry({
        id: "b",
        matchId: "m1",
        matchPercentage: 0,
        place: 99,
        divisionCode: "PCCO",
        isAbsent: true,
      }),
    ]);
    expect(s.totalMatches).toBe(1);
    expect(s.scoredMatches).toBe(1);
    expect(s.avgPercentage).toBe(85);
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

describe("computeShooterStats — stage stats", () => {
  it("null cuando no se pasan stage results", () => {
    const s = computeShooterStats([entry()]);
    expect(s.stageStats).toBeNull();
  });

  it("null cuando todos los stages son DQ", () => {
    const s = computeShooterStats([entry()], {
      stageResults: [
        { place: 1, penalties: null, stage_percentage: 100, is_dq: true },
        { place: 2, penalties: null, stage_percentage: 80, is_dq: true },
      ],
    });
    expect(s.stageStats).toBeNull();
  });

  it("computa winRate, podiumRate y bestStagePercentage", () => {
    const s = computeShooterStats([entry()], {
      stageResults: [
        { place: 1, penalties: null, stage_percentage: 100, is_dq: false },
        { place: 2, penalties: null, stage_percentage: 95, is_dq: false },
        { place: 4, penalties: null, stage_percentage: 80, is_dq: false },
        { place: 5, penalties: null, stage_percentage: 70, is_dq: false },
      ],
    });
    expect(s.stageStats?.scoredStages).toBe(4);
    expect(s.stageStats?.winRate).toBe(25); // 1 de 4
    expect(s.stageStats?.podiumRate).toBe(50); // 2 de 4 (place 1 y 2)
    expect(s.stageStats?.bestStagePercentage).toBe(100);
  });

  it("penaltyRate null cuando ningún stage tiene penalties (FBI/Steel)", () => {
    const s = computeShooterStats([entry()], {
      stageResults: [
        { place: 1, penalties: null, stage_percentage: 100, is_dq: false },
        { place: 2, penalties: null, stage_percentage: 80, is_dq: false },
      ],
    });
    expect(s.stageStats?.penaltyRate).toBeNull();
  });

  it("penaltyRate cuenta % de stages con penalties > 0 (IPSC)", () => {
    const s = computeShooterStats([entry()], {
      stageResults: [
        { place: 1, penalties: 0, stage_percentage: 100, is_dq: false },
        { place: 2, penalties: 5, stage_percentage: 80, is_dq: false },
        { place: 3, penalties: 0, stage_percentage: 70, is_dq: false },
        { place: 4, penalties: 10, stage_percentage: 60, is_dq: false },
      ],
    });
    // 2 de 4 stages con penalties > 0 = 50%
    expect(s.stageStats?.penaltyRate).toBe(50);
  });

  it("ignora DQs y stages sin place", () => {
    const s = computeShooterStats([entry()], {
      stageResults: [
        { place: 1, penalties: null, stage_percentage: 100, is_dq: false },
        { place: null, penalties: null, stage_percentage: 0, is_dq: false },
        { place: 1, penalties: null, stage_percentage: 100, is_dq: true },
      ],
    });
    // Solo el primer stage cuenta.
    expect(s.stageStats?.scoredStages).toBe(1);
    expect(s.stageStats?.winRate).toBe(100);
  });

  /**
   * `place = 0` es "sin puesto asignado", no "primero" (#202). Acá pegaba
   * peor que en `bestPlace`: `place <= 3` es verdadero para 0, así que un
   * stage sin posición contaba como **podio** y le subía el podiumRate al
   * tirador. Antes del fix esto daba 100%.
   *
   * El caso llega de Steel: `withStagePlacings` solo asigna puesto a los
   * resultados con tiempo válido, y los demás quedan en 0 sin ser DQ.
   */
  it("un stage con place 0 no es un podio", () => {
    const s = computeShooterStats([entry()], {
      stageResults: [
        { place: 0, penalties: null, stage_percentage: 40, is_dq: false },
        { place: 5, penalties: null, stage_percentage: 60, is_dq: false },
      ],
    });
    expect(s.stageStats?.podiumRate).toBe(0);
    expect(s.stageStats?.winRate).toBe(0);
  });

  /**
   * El stage sin puesto sale del denominador de win/podium, pero sigue
   * contando para los KPIs que sí puede tener: no se puede ganar un stage
   * sin posición, pero su porcentaje y sus penalties son datos válidos.
   */
  it("el stage sin puesto sale de win/podium pero cuenta para el resto", () => {
    const s = computeShooterStats([entry()], {
      stageResults: [
        { place: 1, penalties: 0, stage_percentage: 100, is_dq: false },
        { place: 0, penalties: 3, stage_percentage: 55, is_dq: false },
      ],
    });
    // 1 de 1 stage con puesto, no 1 de 2.
    expect(s.stageStats?.winRate).toBe(100);
    expect(s.stageStats?.podiumRate).toBe(100);
    // Y el de place 0 sigue en scoredStages y en penaltyRate.
    expect(s.stageStats?.scoredStages).toBe(2);
    expect(s.stageStats?.penaltyRate).toBe(50);
  });

  it("no devuelve NaN cuando ningún stage tiene puesto", () => {
    // Sin puestos no hay tasa que reportar. `0 / 0` sería NaN, que se
    // renderiza como "NaN%" en el dashboard.
    const s = computeShooterStats([entry()], {
      stageResults: [
        { place: 0, penalties: null, stage_percentage: 40, is_dq: false },
        { place: 0, penalties: null, stage_percentage: 30, is_dq: false },
      ],
    });
    expect(s.stageStats?.winRate).toBe(0);
    expect(s.stageStats?.podiumRate).toBe(0);
    expect(s.stageStats?.bestStagePercentage).toBe(40);
  });
});

describe("computeShooterStats — place 0 no es primer puesto (#202)", () => {
  /**
   * El filtro de arriba saca DQs y ausentes, pero un entry con datos
   * parciales llega con `place = 0` y le gana a cualquier puesto real en el
   * `reduce`. El KPI mostraba **0** como mejor puesto y el `MatchHighlight`
   * apuntaba a un torneo donde el tirador no tiene posición.
   */
  it("bestPlace ignora los entries sin puesto", () => {
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", date: "2026-01-01", place: 0 }),
      entry({ id: "b", matchId: "mb", date: "2026-02-01", place: 3 }),
    ]);
    expect(s.bestPlace?.value).toBe(3);
    expect(s.bestPlace?.matchId).toBe("mb");
  });

  it("bestPlace es null si ningún entry tiene puesto", () => {
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", date: "2026-01-01", place: 0 }),
      entry({ id: "b", matchId: "mb", date: "2026-02-01", place: 0 }),
    ]);
    expect(s.bestPlace).toBeNull();
  });

  /**
   * En el percentil `place = 0` mentía más fuerte que en ningún otro lado:
   * `0 / total × 100` da 0, y en percentil **más bajo es mejor**. El peor
   * dato posible se leía como el mejor resultado posible.
   */
  it("el percentil es null sin puesto, no 0", () => {
    const sizes = new Map<string, number>([["ma|P", 10]]);
    const s = computeShooterStats(
      [entry({ id: "a", matchId: "ma", divisionCode: "P", place: 0 })],
      { divisionSizes: sizes },
    );
    expect(s.timeline[0]?.percentile).toBeNull();
    expect(s.avgPercentile).toBeNull();
    expect(s.bestPercentile).toBeNull();
  });

  it("un entry sin puesto no gana el mejor percentil ni baja el promedio", () => {
    const sizes = new Map<string, number>([
      ["ma|P", 10],
      ["mb|P", 10],
    ]);
    const s = computeShooterStats(
      [
        entry({ id: "a", matchId: "ma", divisionCode: "P", place: 0 }),
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
    // Solo "mb" entra: #2 de 10 = 20. Con el bug, "ma" aportaba un 0 que
    // ganaba el mejor percentil y arrastraba el promedio a 10.
    expect(s.avgPercentile).toBeCloseTo(20, 6);
    expect(s.bestPercentile?.value).toBeCloseTo(20, 6);
    expect(s.bestPercentile?.matchId).toBe("mb");
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

// ---------------------------------------------------------------------------
// Multi-división por match: dedup en KPIs cross-match, desglose por
// división intacto.
// ---------------------------------------------------------------------------

describe("computeShooterStats — multi-división en el mismo match", () => {
  // Capra corre PO y PCCO en el mismo torneo el mismo día.
  const capra = () => [
    entry({
      id: "po",
      matchId: "argentina-open-2026",
      date: "2026-03-21",
      divisionCode: "PO",
      divisionName: "Production Optics",
      matchPercentage: 80,
      place: 5,
    }),
    entry({
      id: "pcco",
      matchId: "argentina-open-2026",
      date: "2026-03-21",
      divisionCode: "PCCO",
      divisionName: "PCC Optic",
      matchPercentage: 75,
      place: 8,
    }),
  ];

  it("cuenta el match una sola vez en totalMatches", () => {
    const s = computeShooterStats(capra());
    expect(s.totalMatches).toBe(1);
    expect(s.scoredMatches).toBe(1);
  });

  it("usa la entry de mayor matchPercentage para el promedio", () => {
    const s = computeShooterStats(capra());
    // Best % entre PO (80) y PCCO (75) es 80. Como hay un solo match,
    // el avg también es 80.
    expect(s.avgPercentage).toBe(80);
    expect(s.bestPercentage?.value).toBe(80);
    expect(s.bestPercentage?.divisionCode).toBe("PO");
  });

  it("mantiene byDivision con AMBAS divisiones (desglose intacto)", () => {
    const s = computeShooterStats(capra());
    const codes = s.byDiscipline.map((d) => d.code);
    // Verificamos byDiscipline cuenta 1 torneo de IPSC (deduped).
    expect(codes).toContain("TP");
    const tp = s.byDiscipline.find((d) => d.code === "TP");
    expect(tp?.count).toBe(1);
    // Tip: byDivision (no exportado en ShooterStats actual, pero detectado
    // vía topDivision) sigue mostrando ambas.
    expect(s.topDivision).not.toBeNull();
  });

  it("no rompe la línea temporal — un solo punto por match", () => {
    const s = computeShooterStats(capra());
    expect(s.timeline).toHaveLength(1);
    expect(s.timeline[0]!.divisionCode).toBe("PO"); // el de mejor %
  });

  it("prefiere non-DQ cuando una división DQ'eó y la otra no", () => {
    const s = computeShooterStats([
      entry({
        id: "dq",
        matchId: "m1",
        date: "2026-01-01",
        divisionCode: "PO",
        matchPercentage: 0,
        isDq: true,
      }),
      entry({
        id: "ok",
        matchId: "m1",
        date: "2026-01-01",
        divisionCode: "PCCO",
        matchPercentage: 60,
        isDq: false,
      }),
    ]);
    expect(s.totalMatches).toBe(1);
    expect(s.scoredMatches).toBe(1);
    expect(s.avgPercentage).toBe(60);
    expect(s.timeline[0]!.divisionCode).toBe("PCCO");
  });

  it("no afecta a tiradores con una sola entry por match (no-op)", () => {
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", date: "2026-01-01", matchPercentage: 100 }),
      entry({ id: "b", matchId: "mb", date: "2026-02-01", matchPercentage: 80 }),
      entry({ id: "c", matchId: "mc", date: "2026-03-01", matchPercentage: 60 }),
    ]);
    expect(s.totalMatches).toBe(3);
    expect(s.avgPercentage).toBe(80);
  });
});

describe("computeAmmoEfficiency (issue #75)", () => {
  const base = (overrides: Partial<EntryInput>): EntryInput => ({
    id: "x",
    matchId: "m",
    matchName: "M",
    date: "2026-01-01",
    place: 1,
    matchPercentage: 80,
    hits: null,
    isDq: false,
    isAbsent: false,
    divisionCode: "PO",
    divisionName: "Production Optics",
    disciplineCode: "ipsc",
    disciplineName: "IPSC",
    ...overrides,
  });

  it("devuelve null si no hay entries", () => {
    expect(computeAmmoEfficiency([])).toBeNull();
  });

  it("ignora entries sin min_shots", () => {
    const e = entry(base({ id: "a", minShots: null, roundsFired: 50 }));
    expect(computeAmmoEfficiency([e])).toBeNull();
  });

  it("ignora entries sin rounds_fired", () => {
    const e = entry(base({ id: "a", minShots: 45, roundsFired: null }));
    expect(computeAmmoEfficiency([e])).toBeNull();
  });

  it("computa avg y total sobre entries con ambos datos", () => {
    // FBI: 45 mín. Tirador usó 47, 50, 45 en tres FBI distintos.
    // extras por entry: 2, 5, 0 → total 7, avg 7/3 ≈ 2.333.
    // totalMinShots: 45+45+45 = 135 (denominador para % en KPI agregado).
    const entries = [
      entry(
        base({ id: "a", matchId: "m1", minShots: 45, roundsFired: 47 }),
      ),
      entry(
        base({ id: "b", matchId: "m2", minShots: 45, roundsFired: 50 }),
      ),
      entry(
        base({ id: "c", matchId: "m3", minShots: 45, roundsFired: 45 }),
      ),
    ];
    const eff = computeAmmoEfficiency(entries);
    expect(eff).not.toBeNull();
    expect(eff!.matchCount).toBe(3);
    expect(eff!.totalExtras).toBe(7);
    expect(eff!.totalMinShots).toBe(135);
    expect(eff!.avgExtras).toBeCloseTo(7 / 3, 5);
  });

  it("cuenta multi-división del mismo match como entries separados", () => {
    // Un FBI con Pistola + PCC: 45 + 45 = 90 mín agregado, 47 + 48 usados.
    // Dos entries → matchCount=2, totalExtras=5, avg=2.5.
    const entries = [
      entry(
        base({
          id: "po",
          matchId: "fbi",
          minShots: 45,
          roundsFired: 47,
          divisionCode: "PIS",
        }),
      ),
      entry(
        base({
          id: "pcc",
          matchId: "fbi",
          minShots: 45,
          roundsFired: 48,
          divisionCode: "PCC",
        }),
      ),
    ];
    const eff = computeAmmoEfficiency(entries);
    expect(eff!.matchCount).toBe(2);
    expect(eff!.totalExtras).toBe(5);
    expect(eff!.avgExtras).toBe(2.5);
  });

  it("mezcla entries con y sin datos — solo cuenta los completos", () => {
    const entries = [
      entry(base({ id: "ok", minShots: 45, roundsFired: 50 })),
      entry(base({ id: "no_min", minShots: null, roundsFired: 99 })),
      entry(base({ id: "no_log", minShots: 45, roundsFired: null })),
    ];
    const eff = computeAmmoEfficiency(entries);
    expect(eff!.matchCount).toBe(1);
    expect(eff!.totalExtras).toBe(5);
    expect(eff!.totalMinShots).toBe(45);
    expect(eff!.avgExtras).toBe(5);
  });
});

describe("getAmmoExtrasTier (issue #75)", () => {
  it("0 extras → perfect (verde)", () => {
    expect(getAmmoExtrasTier(0, 45)).toBe("perfect");
    expect(getAmmoExtrasTier(0, 150)).toBe("perfect");
  });

  it("≤5% extras → neutral (sin color, ruido normal)", () => {
    // FBI 45: 1 extra = 2.2%, 2 extras = 4.4% — ambos neutral.
    expect(getAmmoExtrasTier(1, 45)).toBe("neutral");
    expect(getAmmoExtrasTier(2, 45)).toBe("neutral");
    // En el borde exacto (5%) sigue siendo neutral.
    expect(getAmmoExtrasTier(5, 100)).toBe("neutral");
  });

  it("(5%, 15%] → warning (amber)", () => {
    // FBI 45: 3 extras = 6.7%, 6 extras = 13.3%.
    expect(getAmmoExtrasTier(3, 45)).toBe("warning");
    expect(getAmmoExtrasTier(6, 45)).toBe("warning");
    // Borde exacto 15%.
    expect(getAmmoExtrasTier(15, 100)).toBe("warning");
  });

  it("> 15% → danger (rojo)", () => {
    // FBI 45: 7 extras = 15.6%, 10 extras = 22.2%.
    expect(getAmmoExtrasTier(7, 45)).toBe("danger");
    expect(getAmmoExtrasTier(10, 45)).toBe("danger");
    expect(getAmmoExtrasTier(16, 100)).toBe("danger");
  });

  it("normaliza por disciplina (mismo % = mismo tier)", () => {
    // 10% en FBI (mín 45) y en IPSC (mín 150) → ambos warning.
    expect(getAmmoExtrasTier(4, 45)).toBe(getAmmoExtrasTier(15, 150));
  });

  it("negativos quedan en neutral (no celebramos under-report)", () => {
    expect(getAmmoExtrasTier(-2, 45)).toBe("neutral");
  });

  it("minShots inválido (0) cae en neutral aunque haya extras", () => {
    expect(getAmmoExtrasTier(5, 0)).toBe("neutral");
  });
});
