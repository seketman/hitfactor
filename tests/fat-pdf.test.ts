import { describe, expect, it } from "vitest";
import { expectParserError } from "./helpers/expect-parser-error";
import {
  detectDisciplineFromFilename,
  isFatPdfFormat,
  parseFatText,
} from "@/lib/parsers/fat-pdf";

/**
 * Fixture sintético del PDF de "RANKING OFICIAL" de la FAT (basado en el
 * archivo real de Tiro FBI "resultados-apertura-fbi.pdf").
 *
 * Los tests corren contra `parseFatText` (pure function): recibe el texto
 * ya extraído + el nombre del archivo, sin necesitar un PDF real.
 *
 * Puntos que ejercita el fixture:
 *  - `PISTOLA GENERAL` / `REVOLVER GENERAL`: rankings que generan entries.
 *  - `PISTOLA VETERANO`: subranking — NO duplica entries en la división PIS,
 *    solo etiqueta la categoría.
 *  - `DAMAS` / `CADETE MAYOR`: secciones sin división explícita — etiquetan
 *    categoría matcheando por nombre.
 *  - `CASTAGÑETO` vs `CASTAGNETO`: el match de nombres ignora acentos/ñ.
 */
const FAT_FBI_TEXT = `RANKING OFICIAL
PISTOLA GENERAL
1. MARTIN SALADINO 40 / 196
2. GUSTAVO CASTAGNETO 40 / 186
3. GASTON ACETO 40 / 185
4. SANTI PEREZ 36 / 164
5. ABRIL SARALEGUI 35 / 138
6. PATRICIA ELISSECHE 21 / 83
REVOLVER GENERAL
1. GASTON ACETO 39 / 178
2. FERNANDO LOPEZ 39 / 173
3. GUSTAVO CASTAGÑETO 36 / 152
PISTOLA VETERANO
1. GUSTAVO CASTAGNETO 40 / 186
2. GASTON ACETO 40 / 185
DAMAS
1. ABRIL SARALEGUI 35 / 138
2. PATRICIA ELISSECHE 21 / 83
CADETE MAYOR
1. SANTI PEREZ 36 / 164`;

describe("isFatPdfFormat", () => {
  it("detecta el ranking oficial de la FAT", () => {
    expect(isFatPdfFormat(FAT_FBI_TEXT)).toBe(true);
  });

  it("rechaza un PDF WinMSS", () => {
    const winmss = `SG CLASSIC -- Overall Match Results
TFABA 1er SOCIAL ESCOPETA Printed mayo 2, 2026 at 16:17
1 100,00 525,0000 61 El Jaouhari, Ignacio CAN`;
    expect(isFatPdfFormat(winmss)).toBe(false);
  });

  it("rechaza texto sin filas de ranking", () => {
    expect(isFatPdfFormat("RANKING OFICIAL\nsin resultados todavía")).toBe(
      false,
    );
  });
});

describe("detectDisciplineFromFilename", () => {
  it("mapea la palabra clave del nombre del archivo a la disciplina", () => {
    expect(detectDisciplineFromFilename("resultados-apertura-fbi.pdf")).toBe(
      "tiro_fbi",
    );
    expect(detectDisciplineFromFilename("ranking_IPSC_2026.pdf")).toBe("ipsc");
    expect(detectDisciplineFromFilename("steel-challenge-final.pdf")).toBe(
      "steel_challenge",
    );
  });

  it("devuelve null si no hay disciplina en el nombre", () => {
    expect(detectDisciplineFromFilename("resultados-apertura.pdf")).toBeNull();
  });

  it("devuelve null si el nombre es ambiguo (2+ disciplinas)", () => {
    expect(detectDisciplineFromFilename("fbi-vs-ipsc.pdf")).toBeNull();
  });
});

describe("parseFatText — ranking FBI", () => {
  const parsed = parseFatText(FAT_FBI_TEXT, "resultados-apertura-fbi.pdf");

  it("identifica disciplina y source", () => {
    expect(parsed.discipline).toBe("tiro_fbi");
    expect(parsed.source).toBe("fat_pdf");
    expect(parsed.generatedBy).toBe("FAT");
  });

  it("deriva el nombre del torneo del nombre del archivo", () => {
    expect(parsed.name).toBe("Apertura");
  });

  it("deja la fecha vacía cuando el archivo no la trae", () => {
    expect(parsed.date).toBe("");
  });

  it("no genera stages (el formato no los incluye)", () => {
    expect(parsed.stages).toEqual([]);
  });

  it("usa la sección GENERAL como ranking, sin duplicar por VETERANO", () => {
    const pis = parsed.matchEntries.filter((e) => e.divisionCode === "PIS");
    const rev = parsed.matchEntries.filter((e) => e.divisionCode === "REV");
    // PISTOLA GENERAL trae 6; PISTOLA VETERANO (subranking) no suma entries.
    expect(pis).toHaveLength(6);
    expect(rev).toHaveLength(3);
    expect(parsed.matchEntries).toHaveLength(9);
  });

  it("extrae puesto, puntos e impactos de cada fila", () => {
    const saladino = parsed.matchEntries.find(
      (e) => e.shooter.fullName === "MARTIN SALADINO",
    );
    expect(saladino).toBeDefined();
    expect(saladino!.divisionCode).toBe("PIS");
    expect(saladino!.place).toBe(1);
    expect(saladino!.matchPoints).toBe(196);
    expect(saladino!.hits).toBe(40);
    expect(saladino!.matchPercentage).toBeCloseTo(100);
  });

  it("calcula el porcentaje relativo al ganador de la división", () => {
    const castagneto = parsed.matchEntries.find(
      (e) => e.divisionCode === "PIS" && e.shooter.fullName.includes("CASTAGNETO"),
    );
    expect(castagneto!.matchPercentage).toBeCloseTo((186 / 196) * 100);
  });

  it("etiqueta la categoría desde las secciones VETERANO / DAMAS / CADETE", () => {
    const byName = (name: string, div: string) =>
      parsed.matchEntries.find(
        (e) => e.shooter.fullName === name && e.divisionCode === div,
      );

    expect(byName("GUSTAVO CASTAGNETO", "PIS")!.category).toBe("Veterano");
    expect(byName("ABRIL SARALEGUI", "PIS")!.category).toBe("Damas");
    expect(byName("PATRICIA ELISSECHE", "PIS")!.category).toBe("Damas");
    expect(byName("SANTI PEREZ", "PIS")!.category).toBe("Cadete Mayor");
  });

  it("deja category null para un tirador que solo está en GENERAL", () => {
    const saladino = parsed.matchEntries.find(
      (e) => e.shooter.fullName === "MARTIN SALADINO",
    );
    expect(saladino!.category).toBeNull();
  });

  it("matchea el mismo tirador entre secciones ignorando acentos/ñ", () => {
    // En REVOLVER aparece "CASTAGÑETO" y en PISTOLA VETERANO "CASTAGNETO":
    // la categoría se le asigna igual a la entry de REVOLVER.
    const revCastagneto = parsed.matchEntries.find(
      (e) => e.divisionCode === "REV" && e.shooter.fullName.includes("CASTAG"),
    );
    expect(revCastagneto!.category).toBe("Veterano");
  });

  it("no asigna región ni clasificación (el formato no las trae)", () => {
    expect(parsed.region).toBeNull();
    for (const e of parsed.matchEntries) {
      expect(e.shooter.region).toBeNull();
      expect(e.classification).toBeNull();
      expect(e.isDq).toBe(false);
    }
  });
});

describe("parseFatText — fecha en el nombre del archivo", () => {
  it("toma la fecha del filename cuando está presente", () => {
    const parsed = parseFatText(FAT_FBI_TEXT, "ranking-2026-04-15-fbi.pdf");
    expect(parsed.date).toBe("2026-04-15");
  });
});

describe("parseFatText — errores claros", () => {
  it("rechaza el import si no se puede determinar la disciplina", () => {
    expectParserError(
      () => parseFatText(FAT_FBI_TEXT, "resultados-apertura.pdf"),
      "fatUnknownDiscipline",
      { filename: "resultados-apertura.pdf" },
    );
  });

  it("rechaza el import si ninguna sección mapea a una división", () => {
    // Disciplina combat: no tiene divisiones mapeadas → ninguna sección
    // genera entries.
    expect(() =>
      parseFatText(FAT_FBI_TEXT, "resultados-apertura-combat.pdf"),
    ).toThrow(/divisi[oó]n/i);
  });
});
