import { describe, expect, it } from "vitest";
import { DISCIPLINE } from "@/lib/disciplines";
import {
  normalizeDivisionName,
  resolveDivisionCode,
} from "@/lib/parsers/division-registry";

describe("normalizeDivisionName", () => {
  it("saca tildes, pasa a mayúsculas y colapsa espacios", () => {
    expect(normalizeDivisionName("  Revólver  ")).toBe("REVOLVER");
    expect(normalizeDivisionName("Production  Optics")).toBe(
      "PRODUCTION OPTICS",
    );
  });
});

describe("resolveDivisionCode — IPSC", () => {
  const cases: Array<[string, string]> = [
    ["Open", "O"],
    ["Production", "P"],
    ["Production Optics", "PO"],
    ["Standard", "S"],
    ["Standard Manual", "SM"],
    ["Carry Optics", "CO"],
    ["Optics", "CO"], // alias ESS
    ["Revolver", "R"],
    ["Classic", "CL"],
    ["Classic Manual", "CM"], // escopeta (antes solo en practiscore-pdf)
    ["Modified", "MS"],
    ["Modified Shotgun", "MS"],
    ["PCC", "PCC"],
    ["PCC Iron", "PCC"], // alias WinMSS (antes faltaba en otros)
    ["PC Iron", "PCC"], // alias ESS
    ["Pistol Caliber Carbine", "PCC"], // alias practiscore-pdf
    ["PCC Optic", "PCCO"],
    ["PCC Optics", "PCCO"],
    ["PC Optics", "PCCO"],
    ["SG Open", "O"], // prefijo shotgun WinMSS
    ["SG Classic", "CL"],
    ["Pistola", "PIS"],
    ["Pistola P. Optic", "PO"], // Production Optics, label PractiScore AR
    ["Pistola Production Optic", "PO"],
  ];
  it.each(cases)("'%s' → %s", (name, code) => {
    expect(resolveDivisionCode(DISCIPLINE.IPSC, name)).toBe(code);
  });

  it("devuelve null para divisiones desconocidas", () => {
    expect(resolveDivisionCode(DISCIPLINE.IPSC, "Bullseye")).toBeNull();
  });

  it("matchea la variante sin espacios (kerning de pdfjs: 'P ISTOLA')", () => {
    expect(resolveDivisionCode(DISCIPLINE.IPSC, "P ISTOLA")).toBe("PIS");
  });
});

describe("resolveDivisionCode — FBI / Steel", () => {
  it("FBI mapea sus divisiones", () => {
    expect(resolveDivisionCode(DISCIPLINE.FBI, "Pistola")).toBe("PIS");
    expect(resolveDivisionCode(DISCIPLINE.FBI, "Revólver")).toBe("REV");
    expect(resolveDivisionCode(DISCIPLINE.FBI, "Minirifle")).toBe("MINI");
    expect(resolveDivisionCode(DISCIPLINE.FBI, "PCC")).toBe("PCC");
  });

  it("Steel usa el nombre como code", () => {
    expect(resolveDivisionCode(DISCIPLINE.STEEL, "Open")).toBe("OPEN");
    expect(resolveDivisionCode(DISCIPLINE.STEEL, "Iron")).toBe("IRON");
  });

  it("no mezcla disciplinas: 'Open' no es IPSC code en Steel", () => {
    // En Steel 'Open' → 'OPEN' (no 'O'); en IPSC → 'O'. Verifica el aislamiento.
    expect(resolveDivisionCode(DISCIPLINE.STEEL, "Open")).toBe("OPEN");
    expect(resolveDivisionCode(DISCIPLINE.IPSC, "Open")).toBe("O");
  });
});
