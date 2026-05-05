import { describe, expect, it } from "vitest";
import { parseRegion, getClubCode, getClubName } from "@/lib/clubs";

describe("parseRegion", () => {
  it("detecta el país y el club en ARG-TFALP", () => {
    const r = parseRegion("ARG-TFALP");
    expect(r.country).toBe("ARG");
    expect(r.clubCode).toBe("TFALP");
    expect(r.clubName).toBe("Tiro Federal Argentino de La Plata");
  });

  it("también funciona si el orden es TFALP-ARG", () => {
    const r = parseRegion("TFALP-ARG");
    expect(r.country).toBe("ARG");
    expect(r.clubCode).toBe("TFALP");
    expect(r.clubName).toBe("Tiro Federal Argentino de La Plata");
  });

  it("devuelve el código si el club no está mapeado", () => {
    const r = parseRegion("ARG-XYZ");
    expect(r.clubCode).toBe("XYZ");
    expect(r.clubName).toBe("XYZ");
  });

  it("acepta sólo el código del club", () => {
    const r = parseRegion("TFLZ");
    expect(r.country).toBeNull();
    expect(r.clubCode).toBe("TFLZ");
    expect(r.clubName).toBe("Tiro Federal de Lomas de Zamora");
  });

  it("maneja null/empty sin romper", () => {
    expect(parseRegion(null).clubName).toBeNull();
    expect(parseRegion("").clubName).toBeNull();
    expect(parseRegion(undefined).clubName).toBeNull();
  });

  it("getClubName / getClubCode funcionan en combinación", () => {
    expect(getClubName("ARG-TFABA")).toBe("Tiro Federal Argentino Buenos Aires");
    expect(getClubCode("ARG-TFABA")).toBe("TFABA");
  });
});
