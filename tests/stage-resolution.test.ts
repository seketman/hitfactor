import { describe, expect, it } from "vitest";
import {
  findBestPrefixMatch,
  stripStageSuffix,
} from "@/lib/import/import-match";

describe("stripStageSuffix", () => {
  it("quita sufijo Stage N (caso PractiScore inglés)", () => {
    expect(stripStageSuffix("TP ESCOPETA 20/02/26 TFALP - Stage 1")).toBe(
      "TP ESCOPETA 20/02/26 TFALP",
    );
    expect(stripStageSuffix("Match X - Stage 12")).toBe("Match X");
  });

  it("quita sufijo Ejercicio N (variante en español)", () => {
    expect(stripStageSuffix("2° RanKing Social - Ejercicio 6")).toBe(
      "2° RanKing Social",
    );
  });

  it("quita variantes Ej., Etapa, Stand, St., Match", () => {
    expect(stripStageSuffix("Torneo X - Etapa 3")).toBe("Torneo X");
    expect(stripStageSuffix("Torneo X - Stand 2")).toBe("Torneo X");
    expect(stripStageSuffix("Torneo X - Ej. 4")).toBe("Torneo X");
    expect(stripStageSuffix("Torneo X - St. 5")).toBe("Torneo X");
    expect(stripStageSuffix("Torneo X - Match 1")).toBe("Torneo X");
  });

  it("es case-insensitive", () => {
    expect(stripStageSuffix("Foo - stage 7")).toBe("Foo");
    expect(stripStageSuffix("Foo - EJERCICIO 7")).toBe("Foo");
  });

  it("acepta paréntesis con descripción del stage", () => {
    expect(
      stripStageSuffix("Mundial 2026 - Stage 4 (Take a stand)"),
    ).toBe("Mundial 2026");
  });

  it("no toca nombres sin sufijo de stage", () => {
    expect(stripStageSuffix("2° RanKing Social")).toBe("2° RanKing Social");
    expect(stripStageSuffix("TP ESCOPETA 20/02/26 TFALP")).toBe(
      "TP ESCOPETA 20/02/26 TFALP",
    );
  });

  it("no confunde si la palabra Stage aparece en el medio", () => {
    expect(stripStageSuffix("Stage Hands Cup 2026")).toBe(
      "Stage Hands Cup 2026",
    );
  });
});

describe("findBestPrefixMatch", () => {
  it("encuentra el match cuando el name es prefijo del stage title", () => {
    const candidates = [
      { id: "1", name: "2° RanKing Social" },
      { id: "2", name: "Torneo X" },
    ];
    const found = findBestPrefixMatch(
      "2° RanKing Social - Ejercicio 6",
      candidates,
    );
    expect(found?.id).toBe("1");
  });

  it("matchea ignorando acentos y mayúsculas", () => {
    const candidates = [{ id: "1", name: "2° Ranking Social" }];
    const found = findBestPrefixMatch(
      "2° RANKING SOCIAL - Ejercicio 6",
      candidates,
    );
    expect(found?.id).toBe("1");
  });

  it("elige el match más largo cuando hay varios prefijos posibles", () => {
    const candidates = [
      { id: "short", name: "Open" },
      { id: "long", name: "Open Cup 2026" },
    ];
    const found = findBestPrefixMatch(
      "Open Cup 2026 - Stage 3",
      candidates,
    );
    expect(found?.id).toBe("long");
  });

  it("devuelve null si ningún candidato es prefijo", () => {
    const candidates = [
      { id: "1", name: "Otro torneo" },
      { id: "2", name: "Tercer torneo" },
    ];
    expect(findBestPrefixMatch("Open Cup 2026 - Stage 3", candidates)).toBe(
      null,
    );
  });

  it("acepta separador en-dash o em-dash entre name y sufijo", () => {
    const candidates = [{ id: "1", name: "Mundial 2026" }];
    expect(findBestPrefixMatch("Mundial 2026 – Stage 1", candidates)?.id).toBe(
      "1",
    );
    expect(findBestPrefixMatch("Mundial 2026 — Stage 1", candidates)?.id).toBe(
      "1",
    );
  });

  it("no matchea cuando el name está contenido pero no como prefijo limpio", () => {
    const candidates = [{ id: "1", name: "Cup" }];
    // "Open Cup ..." no empieza con "Cup"
    expect(findBestPrefixMatch("Open Cup 2026 - Stage 1", candidates)).toBe(
      null,
    );
  });
});
