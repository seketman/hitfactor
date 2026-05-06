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
    expect(s.trendDelta).toBeNull();
    expect(s.trendWindow).toBe(0);
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
  it("calcula KPIs básicos sin tendencia", () => {
    const s = computeShooterStats([
      entry({ matchPercentage: 75, place: 5 }),
    ]);
    expect(s.totalMatches).toBe(1);
    expect(s.scoredMatches).toBe(1);
    expect(s.avgPercentage).toBe(75);
    expect(s.bestPercentage?.value).toBe(75);
    expect(s.bestPlace?.value).toBe(5);
    expect(s.trendDelta).toBeNull();
    expect(s.trendWindow).toBe(0);
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

describe("computeShooterStats — trendDelta", () => {
  it("null si hay menos de 2 matches válidos", () => {
    const s = computeShooterStats([entry({ matchPercentage: 50 })]);
    expect(s.trendDelta).toBeNull();
    expect(s.trendWindow).toBe(0);
  });

  it("achica la ventana cuando hay menos de 6 matches", () => {
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", date: "2026-01-01", matchPercentage: 60 }),
      entry({ id: "b", matchId: "mb", date: "2026-02-01", matchPercentage: 80 }),
    ]);
    expect(s.trendWindow).toBe(1);
    expect(s.trendDelta).toBe(20);
  });

  it("usa ventana de 3 con 6 matches o más", () => {
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", date: "2026-01-01", matchPercentage: 50 }),
      entry({ id: "b", matchId: "mb", date: "2026-02-01", matchPercentage: 60 }),
      entry({ id: "c", matchId: "mc", date: "2026-03-01", matchPercentage: 70 }),
      entry({ id: "d", matchId: "md", date: "2026-04-01", matchPercentage: 80 }),
      entry({ id: "e", matchId: "me", date: "2026-05-01", matchPercentage: 90 }),
      entry({ id: "f", matchId: "mf", date: "2026-06-01", matchPercentage: 100 }),
    ]);
    expect(s.trendWindow).toBe(3);
    // recientes: (80+90+100)/3=90, anteriores: (50+60+70)/3=60 → +30
    expect(s.trendDelta).toBe(30);
  });

  it("tendencia negativa cuando empeoró", () => {
    const s = computeShooterStats([
      entry({ id: "a", matchId: "ma", date: "2026-01-01", matchPercentage: 90 }),
      entry({ id: "b", matchId: "mb", date: "2026-02-01", matchPercentage: 80 }),
      entry({ id: "c", matchId: "mc", date: "2026-03-01", matchPercentage: 60 }),
      entry({ id: "d", matchId: "md", date: "2026-04-01", matchPercentage: 50 }),
    ]);
    // half=2: recientes (60+50)/2=55, anteriores (90+80)/2=85 → -30
    expect(s.trendWindow).toBe(2);
    expect(s.trendDelta).toBe(-30);
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
