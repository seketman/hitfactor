import { describe, expect, it } from "vitest";
import {
  buildClubLookup,
  getClubCode,
  getClubName,
  parseRegion,
} from "@/lib/clubs";

const LOOKUP = buildClubLookup([
  { code: "TFALP", name: "Tiro Federal Argentino de La Plata" },
  { code: "TFLZ", name: "Tiro Federal de Lomas de Zamora" },
  { code: "TFABA", name: "Tiro Federal Argentino de Buenos Aires" },
  { code: "TFC", name: "Tiro Federal Cordoba" },
]);

describe("parseRegion", () => {
  it("detecta el país y el club en ARG-TFALP", () => {
    const r = parseRegion("ARG-TFALP");
    expect(r.country).toBe("ARG");
    expect(r.clubCode).toBe("TFALP");
  });

  it("también funciona si el orden es TFALP-ARG", () => {
    const r = parseRegion("TFALP-ARG");
    expect(r.country).toBe("ARG");
    expect(r.clubCode).toBe("TFALP");
  });

  it("acepta sólo el código del club", () => {
    const r = parseRegion("TFLZ");
    expect(r.country).toBeNull();
    expect(r.clubCode).toBe("TFLZ");
  });

  it("acepta sólo el código de país", () => {
    const r = parseRegion("ARG");
    expect(r.country).toBe("ARG");
    expect(r.clubCode).toBeNull();
  });

  it("maneja null/empty sin romper", () => {
    expect(parseRegion(null).clubCode).toBeNull();
    expect(parseRegion("").clubCode).toBeNull();
    expect(parseRegion(undefined).clubCode).toBeNull();
  });
});

describe("getClubCode", () => {
  it("extrae el code de un region compuesto", () => {
    expect(getClubCode("ARG-TFC")).toBe("TFC");
  });

  it("devuelve null cuando no hay region", () => {
    expect(getClubCode(null)).toBeNull();
  });
});

describe("getClubName", () => {
  it("resuelve el nombre desde el catálogo", () => {
    expect(getClubName("ARG-TFC", LOOKUP)).toBe("Tiro Federal Cordoba");
    expect(getClubName("TFABA", LOOKUP)).toBe(
      "Tiro Federal Argentino de Buenos Aires",
    );
  });

  it("cae al code cuando no está en el catálogo", () => {
    expect(getClubName("ARG-XYZ", LOOKUP)).toBe("XYZ");
  });

  it("devuelve null si no hay region", () => {
    expect(getClubName(null, LOOKUP)).toBeNull();
    expect(getClubName("", LOOKUP)).toBeNull();
  });
});
