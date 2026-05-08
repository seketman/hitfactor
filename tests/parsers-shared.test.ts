import { describe, expect, it } from "vitest";
import {
  extractClubFromTitle,
  pickMostCommon,
} from "@/lib/parsers/shared";

describe("extractClubFromTitle", () => {
  it("detecta token uppercase al inicio (ej: TFABA 1er SOCIAL ESCOPETA)", () => {
    expect(extractClubFromTitle("TFABA 1er SOCIAL ESCOPETA")).toBe("TFABA");
  });

  it("detecta token uppercase al final (ej: TP ESCOPETA 20/02/26 TFALP)", () => {
    expect(extractClubFromTitle("TP ESCOPETA 20/02/26 TFALP")).toBe("TFALP");
  });

  it("devuelve null cuando no hay token uppercase claro", () => {
    expect(extractClubFromTitle("Social 4")).toBeNull();
    expect(extractClubFromTitle("1er Ranking Social 2026")).toBeNull();
    expect(extractClubFromTitle("Final De Curso 2026-03")).toBeNull();
  });

  it("devuelve null para título vacío o nullish", () => {
    expect(extractClubFromTitle("")).toBeNull();
    expect(extractClubFromTitle(null)).toBeNull();
    expect(extractClubFromTitle(undefined)).toBeNull();
    expect(extractClubFromTitle("   ")).toBeNull();
  });

  it("rechaza tokens demasiado cortos (TP, GS, etc.) — evita falsos positivos", () => {
    // "TP" es solo 2 chars, no calificada. El parseo cae al fallback (trailing).
    expect(extractClubFromTitle("TP test")).toBeNull();
    // "GS Open" tampoco — GS es solo 2 chars (también categoría IPSC)
    expect(extractClubFromTitle("GS Open match")).toBeNull();
  });

  it("acepta tokens alfanuméricos (ej: ATyGQ es 5 chars con minúsculas — NO matches)", () => {
    // Notar que ATyGQ tiene 'y' minúscula → no matchea uppercase puro.
    // Es un caso conocido — los clubes con letras minúsculas se editan a mano.
    expect(extractClubFromTitle("ATyGQ Match")).toBeNull();
  });
});

describe("pickMostCommon", () => {
  it("devuelve el valor más frecuente", () => {
    expect(pickMostCommon(["TFALP", "TFALP", "ATyGQ"])).toBe("TFALP");
    expect(pickMostCommon(["A", "B", "B", "C", "B"])).toBe("B");
  });

  it("ignora null/undefined al contar", () => {
    expect(pickMostCommon(["TFALP", null, undefined, "TFALP"])).toBe("TFALP");
  });

  it("devuelve null si todos son nullish o el array está vacío", () => {
    expect(pickMostCommon([])).toBeNull();
    expect(pickMostCommon([null, null, undefined])).toBeNull();
  });

  it("en caso de empate devuelve el primero que llegó al máximo", () => {
    // "A" y "B" tienen 2 cada uno; A llegó primero a 2.
    expect(pickMostCommon(["A", "A", "B", "B"])).toBe("A");
  });
});
