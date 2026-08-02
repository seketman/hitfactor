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

  // Los clubes abrevian con y sin punto de forma intercambiable. Sin esto
  // haría falta una clave por variante ortográfica.
  it("saca los puntos de las abreviaturas", () => {
    expect(normalizeDivisionName("Pistola Prod.")).toBe("PISTOLA PROD");
    expect(normalizeDivisionName("Pistola P. Optic")).toBe("PISTOLA P OPTIC");
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
    // Rótulos de TFALP (PractiScore Android). "Pistola Prod." es Production
    // a secas — el club lo abrevia y la columna `Div` de esas filas dice
    // "PP", que no es un code de la DB.
    ["Pistola Prod.", "P"],
    ["Pistola Prod", "P"],
    ["Pistola Produccion", "P"],
    ["Pistola Producción", "P"],
    ["Pistola Production", "P"],
    ["Pistola Optic", "PO"],
    ["Pistola Optics", "PO"],
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
    // Divisiones extendidas que corren algunos clubes (migraciones 0016/0019).
    expect(resolveDivisionCode(DISCIPLINE.FBI, "Classic")).toBe("CLASSIC");
    expect(resolveDivisionCode(DISCIPLINE.FBI, "Optic")).toBe("OPTIC");
  });

  it("no mezcla el OPTIC de FBI con el de Steel (unique es por disciplina)", () => {
    expect(resolveDivisionCode(DISCIPLINE.FBI, "Optic")).toBe("OPTIC");
    expect(resolveDivisionCode(DISCIPLINE.STEEL, "Optic")).toBe("OPTIC");
    // …pero Steel no conoce las de FBI.
    expect(resolveDivisionCode(DISCIPLINE.STEEL, "Minirifle")).toBeNull();
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
