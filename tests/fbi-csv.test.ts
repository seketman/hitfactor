import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isFbiCsvFormat, parseFbiCsv } from "@/lib/parsers/fbi-csv";
import { parseFile } from "@/lib/parsers";

const FIXTURES = join(__dirname, "fixtures", "fbi");
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

const SOCIAL4 = read("social4.csv");

describe("isFbiCsvFormat", () => {
  it("detecta CSV con headers FBI", () => {
    expect(isFbiCsvFormat(SOCIAL4)).toBe(true);
  });

  it("rechaza HTML aunque tenga la palabra 'Tirador'", () => {
    const html = "<html><body><table><tr><th>Tirador</th></tr></table></body></html>";
    expect(isFbiCsvFormat(html)).toBe(false);
  });

  it("rechaza CSV con headers distintos", () => {
    const csv = "Name,Score\nFoo,100\n";
    expect(isFbiCsvFormat(csv)).toBe(false);
  });
});

describe("parseFbiCsv — Social 4", () => {
  const parsed = parseFbiCsv(SOCIAL4);

  it("identifica disciplina y source", () => {
    expect(parsed.discipline).toBe("tiro_fbi");
    expect(parsed.source).toBe("fbi_csv");
  });

  it("extrae nombre y fecha del título", () => {
    expect(parsed.name).toBe("Social 4");
    expect(parsed.date).toBe("2026-05-03");
  });

  it("ignora filas sin Tirador", () => {
    // El fixture tiene varias filas vacías al final; deben descartarse.
    expect(parsed.matchEntries.length).toBeGreaterThan(0);
    expect(parsed.matchEntries.length).toBeLessThan(50);
  });

  it("mapea Disciplina del CSV a códigos de división", () => {
    const codes = new Set(parsed.matchEntries.map((e) => e.divisionCode));
    // El fixture tiene Minirifle y PCC.
    expect(codes.has("MINI")).toBe(true);
    expect(codes.has("PCC")).toBe(true);
  });

  it("preserva nombres con coma embebida (CSV con comillas)", () => {
    const names = parsed.matchEntries.map((e) => e.shooter.fullName);
    expect(names).toContain("Mariperisena, Matías");
    expect(names).toContain("Pinola, Emilio");
  });

  it("guarda Categoría tal cual viene", () => {
    const matias = parsed.matchEntries.find(
      (e) =>
        e.shooter.fullName === "Mariperisena, Matías" &&
        e.divisionCode === "MINI",
    );
    expect(matias?.category).toBe("A");

    const pinola = parsed.matchEntries.find(
      (e) =>
        e.shooter.fullName === "Pinola, Emilio" && e.divisionCode === "MINI",
    );
    expect(pinola?.category).toBe("B");
  });

  it("usa Club como region del shooter", () => {
    const matias = parsed.matchEntries.find(
      (e) => e.shooter.fullName === "Mariperisena, Matías",
    );
    expect(matias?.shooter.region).toBe("TFALP");
  });

  it("calcula place ordenando por Puntos descendente dentro de cada división", () => {
    const minirifle = parsed.matchEntries
      .filter((e) => e.divisionCode === "MINI")
      .sort((a, b) => a.place - b.place);

    // Aceto Gaston tiene 386 puntos en Minirifle, debería ser #1.
    expect(minirifle[0]?.shooter.fullName).toBe("Aceto Gaston");
    expect(minirifle[0]?.matchPoints).toBe(386);
    expect(minirifle[0]?.place).toBe(1);

    // Mariperisena con 381 va segundo.
    expect(minirifle[1]?.shooter.fullName).toBe("Mariperisena, Matías");
    expect(minirifle[1]?.matchPoints).toBe(381);
    expect(minirifle[1]?.place).toBe(2);
  });

  it("calcula matchPercentage relativo al ganador de la división", () => {
    const minirifle = parsed.matchEntries
      .filter((e) => e.divisionCode === "MINI")
      .sort((a, b) => a.place - b.place);

    expect(minirifle[0]?.matchPercentage).toBe(100);
    // Mariperisena: 381 / 386 = ~98.7%
    expect(minirifle[1]?.matchPercentage).toBeCloseTo((381 / 386) * 100, 4);
  });

  it("ignora puntaje y tiempos: matchPoints = puntos, totalTimeSeconds = null", () => {
    const aceto = parsed.matchEntries.find(
      (e) => e.shooter.fullName === "Aceto Gaston" && e.divisionCode === "MINI",
    );
    expect(aceto?.matchPoints).toBe(386);
    expect(aceto?.totalTimeSeconds).toBeNull();
    expect(aceto?.powerFactor).toBeNull();
    expect(aceto?.classification).toBeNull();
    expect(aceto?.isDq).toBe(false);
  });

  it("places por división son contiguos desde 1", () => {
    const byDivision = new Map<string, number[]>();
    for (const e of parsed.matchEntries) {
      const list = byDivision.get(e.divisionCode) ?? [];
      list.push(e.place);
      byDivision.set(e.divisionCode, list);
    }
    for (const [, places] of byDivision) {
      const sorted = [...places].sort((a, b) => a - b);
      expect(sorted[0]).toBe(1);
      // Sin gaps
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]).toBe(sorted[i - 1]! + 1);
      }
    }
  });
});

describe("parseFile — dispatcher", () => {
  it("delega CSV de FBI a parseFbiCsv", () => {
    const parsed = parseFile(SOCIAL4);
    expect(parsed.discipline).toBe("tiro_fbi");
    expect(parsed.source).toBe("fbi_csv");
  });
});
