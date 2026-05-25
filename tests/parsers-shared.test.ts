import { describe, expect, it } from "vitest";
import {
  extractClubFromTitle,
  pickMostCommon,
  stripNameSuffixes,
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

describe("stripNameSuffixes", () => {
  // Pasada A — paréntesis terminales.
  it("saca un paréntesis terminal tipeado por el organizador", () => {
    expect(stripNameSuffixes("Chong, Gonzalo (Cursaste)")).toBe(
      "Chong, Gonzalo",
    );
  });

  it("saca múltiples paréntesis terminales encadenados", () => {
    expect(stripNameSuffixes("Foo, Bar (Cursando) (Senior)")).toBe("Foo, Bar");
  });

  it("no toca paréntesis en el medio del nombre", () => {
    expect(stripNameSuffixes("Foo (Bar) Baz")).toBe("Foo (Bar) Baz");
  });

  // Pasada B — tokens conocidos al final.
  it("saca región IPSC pegada al final del nombre", () => {
    expect(stripNameSuffixes("CIPOLLETTI, Pablo ARG")).toBe("CIPOLLETTI, Pablo");
  });

  it("saca región + token desconocido + región (caso ARG ESC)", () => {
    // Caso real: WinMSS reconstruye "Region|Marker" como dos tokens. La
    // pasada B itera de derecha a izquierda: saca ESC, luego saca ARG.
    expect(stripNameSuffixes("CIRIONI, Germán ARG ESC")).toBe(
      "CIRIONI, Germán",
    );
  });

  it("saca un código de división trailing", () => {
    expect(stripNameSuffixes("ALZATTO, Luciano PCC")).toBe("ALZATTO, Luciano");
  });

  it("combina pasada A + B en un mismo nombre", () => {
    expect(stripNameSuffixes("Foo, Bar (Cursaste) ARG")).toBe("Foo, Bar");
  });

  it("respeta tokens desconocidos (no agresivo con apellidos cortos)", () => {
    // "Lopez" no está en el set conocido — no lo toca.
    expect(stripNameSuffixes("Diego Lopez")).toBe("Diego Lopez");
    // Letras sueltas no se sacan por más que coincidan con un code DB.
    expect(stripNameSuffixes("García P")).toBe("García P");
  });

  it("es idempotente sobre un nombre ya limpio", () => {
    expect(stripNameSuffixes("Demarziani, Diego")).toBe("Demarziani, Diego");
  });

  it("normaliza acentos al chequear el token (REVÓLVER -> REVOLVER)", () => {
    expect(stripNameSuffixes("Pérez, José REVÓLVER")).toBe("Pérez, José");
  });

  it("saca rol Oficial de Campo (OC) al final del nombre", () => {
    expect(stripNameSuffixes("SUAREZ, Rodrigo Daniel ARG OC")).toBe(
      "SUAREZ, Rodrigo Daniel",
    );
  });

  it("saca categorías IPSC multi-letra Super Senior (SS) y Grand Senior (GS)", () => {
    expect(stripNameSuffixes("TONDINI, Claudio Oscar SS ARG OC")).toBe(
      "TONDINI, Claudio Oscar",
    );
    expect(stripNameSuffixes("ZARATE, Jose GS ARG OC")).toBe("ZARATE, Jose");
  });

  it("NO saca categorías de una sola letra (riesgo de inicial del nombre)", () => {
    // "S" puede ser Senior o una inicial del segundo nombre. Lo dejamos
    // para no introducir falsos positivos.
    expect(stripNameSuffixes("TEJERINA, Eduardo Martin S ARG OC")).toBe(
      "TEJERINA, Eduardo Martin S",
    );
  });
});
