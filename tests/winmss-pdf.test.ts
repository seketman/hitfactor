import { describe, expect, it } from "vitest";
import {
  isWinmssFormat,
  parseWinmssText,
  type WinmssPage,
} from "@/lib/parsers/winmss-pdf";

/**
 * Fixtures sintéticos basados en la salida real de pdf-parse para los
 * archivos WinMSS de ipsc.org.ar (formato del TFABA 1er SOCIAL ESCOPETA).
 *
 * Mantenemos el texto inline en lugar de subir PDFs al repo: los tests
 * corren contra `parseWinmssText` (pure function), y el binding con
 * pdf-parse se valida en el navegador cuando el usuario sube un PDF real.
 */

const overallClassicPage = `SG CLASSIC -- Overall Match Results
TFABA 1er SOCIAL ESCOPETA TFABA 1er SOCIAL ESCOPETA Printed mayo 2, 2026 at 16:17
% Points CompetitorCompetitor Cat Reg Cls Tag ICS
1 100,00 525,0000 61 El Jaouhari, Ignacio CAN
2 56,62 297,2290 8 Luberto, Juan Pablo S ARG RO
3 35,51 186,4264 7 GOMEZ, Gonzalo S ARG RO
World Classification System used Page 1`;

const overallOpenPage = `SG OPEN -- Overall Match Results
TFABA 1er SOCIAL ESCOPETA Printed mayo 2, 2026 at 16:17
% Points CompetitorCompetitor Cat Reg Cls Tag ICS
1 100,00 482,0527 41 Gonzalez, Alejandro S ARG RO
2 92,96 448,0994 63 FORNS, MARTIN EMILIO ARG
3 90,94 438,3549 37 CONSOLE, Santiago CAN
World Classification System used Page 1`;

const overallPistolaPage = `PISTOLA -- Overall Match Results
TFABA 1er SOCIAL ESCOPETA
Printed mayo 2, 2026 at 16:17
% Points CompetitorCompetitor Cat Reg Cls Tag ICS
1 100,00 502,4867 30 Lanza, Claudio Alejand ARG
2 95,17 478,2079 28 GONZALEZ, Diego Fabian S CAN RO
3 84,79 426,0659 26 ZABALA, Juan Manuel S ARG
17 0,00 0,0000 55 ELIZALDE, Luciano CAN
World Classification System used Page 1`;

const stageOpenStage1Page = `OPEN -- Overall Stage Results
TFABA 1er SOCIAL ESCOPETA Printed mayo 2, 2026 at 16:17
Stage 1 -- Etapa 1
PTS TIME FACTOR POINTS PERCENT # Name
HIT STAGE STAGE COMPETITOR
1 110 20,78 5,2936 110,0000 100,00 40 GARNICA RIVEROS, Jorge Efrain
2 110 22,75 4,8352 100,4747 91,34 63 FORNS, MARTIN EMILIO
6 110 62,86 1,7499 36,3633 33,06 18 SAN MIGUEL, Eduardo Jorge
7 0 29,21 0,0000 0,0000 0,00 58 PINOLA, Emilio
8 0 9,45 0,0000 0,0000 0,00 45 Romano, Christian
Page 1`;

const stagePccStage1Page = `PCC OPTIC -- Overall Stage Results
TFABA 1er SOCIAL ESCOPETA Printed mayo 2, 2026 at 16:17
Stage 1 -- Etapa 1
PTS TIME FACTOR POINTS PERCENT # Name
HIT STAGE STAGE COMPETITOR
1 110 20,58 5,3450 110,0000 100,00 36 Cassani, Augusto
2 110 22,12 4,9729 102,3418 93,04 39 Galotto, Pablo
Page 1`;

const stageOpenStage2Page = `OPEN -- Overall Stage Results
TFABA 1er SOCIAL ESCOPETA Printed mayo 2, 2026 at 16:17
Stage 2 -- Etapa 2
PTS TIME FACTOR POINTS PERCENT # Name
HIT STAGE STAGE COMPETITOR
1 80 19,72 4,0568 80,0000 100,00 41 Gonzalez, Alejandro
2 80 22,73 3,5196 69,4061 86,76 37 CONSOLE, Santiago
Page 1`;

function pages(...texts: string[]): WinmssPage[] {
  return texts.map((text, i) => ({ num: i + 1, text }));
}

describe("isWinmssFormat", () => {
  it("detecta WinMSS por header + footer combinados", () => {
    expect(isWinmssFormat(overallOpenPage)).toBe(true);
    expect(isWinmssFormat(stageOpenStage1Page)).toBe(true);
  });

  it("rechaza PDFs sin marcadores WinMSS", () => {
    expect(isWinmssFormat("Some random PDF text")).toBe(false);
    // Tiene 'Overall Match Results' pero no el footer World Classification
    expect(isWinmssFormat("Foo -- Overall Match Results\nbar")).toBe(false);
  });
});

describe("parseWinmssText — formato ESS (Electronic Scoring System)", () => {
  // Fixture sintético del segundo formato que vemos: ESS, no WinMSS.
  // Diferencias clave: header "X - Results Overall" (single dash), mes en
  // inglés ("Printed: May 11, 2026"), decimal con punto, footer "ESS -
  // Electronic Scoring System ... N of N".
  const essOverall = `TFABA - 19 - SEGUNDO SOCIAL PISTOLA 9 MAYO 2026 - Handgun
Printed: May 11, 2026 21:33:24
CLASSIC - Results Overall
% Points Competitor Cat Reg Cls Tag ICS
1 100.00 970.0000 58 SILVA, Lucas ARG
2 61.64 597.9520 51 FAVAREL, Leandro Carlos ARG
Printed May 11, 2026 21:33:24 ESS - Electronic Scoring System 1 of 8`;

  it("detecta formato ESS como WinMSS válido", () => {
    expect(isWinmssFormat(essOverall)).toBe(true);
  });

  it("extrae división con '-' (sin doble dash)", () => {
    const parsed = parseWinmssText(pages(essOverall));
    expect(parsed.matchEntries[0]?.divisionCode).toBe("CL");
    expect(parsed.matchEntries).toHaveLength(2);
  });

  it("prioriza la fecha del título (9 MAYO 2026) sobre Printed (May 11)", () => {
    // El título dice "9 MAYO 2026" — fecha real del match. El "Printed:
    // May 11, 2026" es cuando se generó el PDF. Tomamos la del título.
    const parsed = parseWinmssText(pages(essOverall));
    expect(parsed.date).toBe("2026-05-09");
  });

  it("cae al 'Printed:' cuando el título no tiene fecha embebida", () => {
    const noTitleDate = essOverall.replace("9 MAYO 2026 - Handgun", "Handgun");
    const parsed = parseWinmssText(pages(noTitleDate));
    expect(parsed.date).toBe("2026-05-11");
  });

  it("parsea decimales con punto (100.00 → 100)", () => {
    const parsed = parseWinmssText(pages(essOverall));
    const winner = parsed.matchEntries.find(
      (e) => e.shooter.fullName === "SILVA, Lucas",
    );
    expect(winner?.matchPercentage).toBe(100);
    expect(winner?.matchPoints).toBe(970);
  });

  it("extrae el título completo (ignorando header división, Printed, footer)", () => {
    const parsed = parseWinmssText(pages(essOverall));
    expect(parsed.name).toBe(
      "TFABA - 19 - SEGUNDO SOCIAL PISTOLA 9 MAYO 2026 - Handgun",
    );
  });

  it("mapea 'OPTICS' (ESS) → CO (Carry Optics)", () => {
    const opticsPage = essOverall.replace(
      "CLASSIC - Results Overall",
      "OPTICS - Results Overall",
    );
    const parsed = parseWinmssText(pages(opticsPage));
    expect(parsed.matchEntries[0]?.divisionCode).toBe("CO");
  });

  it("captura filas DQ del formato ESS (sin columna place/%/points)", () => {
    const withDq = `TFABA - 19 - SEGUNDO SOCIAL PISTOLA 9 MAYO 2026 - Handgun
Printed: May 11, 2026 21:33:24
PRODUCTION - Results Overall
% Points Competitor Cat Reg Cls Tag ICS
1 100.00 970.0000 10 SERRANO, Fernando ARG
2 50.00 485.0000 44 MEDAVAR, Pablo ARG
                              39 SGUERA, Santino Eduardo                                  DQ
Printed May 11, 2026 21:33:24 ESS - Electronic Scoring System 2 of 8`;
    const parsed = parseWinmssText(pages(withDq));
    expect(parsed.matchEntries).toHaveLength(3);
    const dq = parsed.matchEntries.find(
      (e) => e.shooter.fullName === "SGUERA, Santino Eduardo",
    );
    expect(dq).toBeDefined();
    expect(dq?.isDq).toBe(true);
    expect(dq?.matchPoints).toBe(0);
    expect(dq?.matchPercentage).toBe(0);
    expect(dq?.divisionCode).toBe("P");
  });

  it("mapea 'PC OPTICS' → PCCO y 'PC IRON' → PCC", () => {
    const pcoPage = essOverall.replace(
      "CLASSIC - Results Overall",
      "PC OPTICS - Results Overall",
    );
    expect(parseWinmssText(pages(pcoPage)).matchEntries[0]?.divisionCode).toBe(
      "PCCO",
    );

    const pcIronPage = essOverall.replace(
      "CLASSIC - Results Overall",
      "PC IRON - Results Overall",
    );
    expect(
      parseWinmssText(pages(pcIronPage)).matchEntries[0]?.divisionCode,
    ).toBe("PCC");
  });
});

describe("parseWinmssText — overall", () => {
  it("extrae nombre y fecha del match", () => {
    const parsed = parseWinmssText(pages(overallClassicPage));
    expect(parsed.name).toBe("TFABA 1er SOCIAL ESCOPETA");
    expect(parsed.date).toBe("2026-05-02");
    expect(parsed.discipline).toBe("ipsc");
    expect(parsed.source).toBe("winmss_pdf");
  });

  it("mapea SG CLASSIC → CL (Classic)", () => {
    const parsed = parseWinmssText(pages(overallClassicPage));
    expect(parsed.matchEntries[0]?.divisionCode).toBe("CL");
    expect(parsed.matchEntries.length).toBe(3);
  });

  it("mapea SG OPEN → O (Open) y otras variantes shotgun", () => {
    const parsed = parseWinmssText(pages(overallOpenPage));
    expect(parsed.matchEntries[0]?.divisionCode).toBe("O");
  });

  it("mapea PISTOLA → PIS (división TFABA genérica)", () => {
    const parsed = parseWinmssText(pages(overallPistolaPage));
    expect(parsed.matchEntries[0]?.divisionCode).toBe("PIS");
  });

  it("tolera kerning roto: 'P ISTOLA' (espacio espurio) → PIS", () => {
    // Caso real: en algunos PDFs `unpdf` extrae la "P" y el resto del
    // nombre como items separados y nuestra reconstrucción los une con
    // espacio. El lookup debe seguir resolviendo.
    const brokenKerning = overallPistolaPage.replace(
      "PISTOLA --",
      "P ISTOLA --",
    );
    const parsed = parseWinmssText(pages(brokenKerning));
    expect(parsed.matchEntries[0]?.divisionCode).toBe("PIS");
    expect(parsed.matchEntries.length).toBeGreaterThan(0);
  });

  it("parsea place, percentage y puntos correctamente", () => {
    const parsed = parseWinmssText(pages(overallClassicPage));
    const winner = parsed.matchEntries.find(
      (e) => e.shooter.fullName === "El Jaouhari, Ignacio",
    );
    expect(winner?.place).toBe(1);
    expect(winner?.matchPercentage).toBe(100);
    expect(winner?.matchPoints).toBe(525);
  });

  it("maneja decimales con coma (formato es-AR)", () => {
    const parsed = parseWinmssText(pages(overallOpenPage));
    const forns = parsed.matchEntries.find(
      (e) => e.shooter.fullName === "FORNS, MARTIN EMILIO",
    );
    // 448,0994 → 448.0994 (no se trunca a 448)
    expect(forns?.matchPoints).toBeCloseTo(448.0994, 4);
    expect(forns?.matchPercentage).toBeCloseTo(92.96, 2);
  });

  it("preserva nombres con coma + multi-token uppercase", () => {
    const parsed = parseWinmssText(pages(overallOpenPage));
    const names = parsed.matchEntries.map((e) => e.shooter.fullName);
    // "FORNS, MARTIN EMILIO" no debería cortarse en EMILIO (no es metadata)
    expect(names).toContain("FORNS, MARTIN EMILIO");
    expect(names).toContain("Gonzalez, Alejandro");
    expect(names).toContain("CONSOLE, Santiago");
  });

  it("extrae metadata: Cat / Reg / ICS", () => {
    const parsed = parseWinmssText(pages(overallOpenPage));
    const gonzalez = parsed.matchEntries.find(
      (e) => e.shooter.fullName === "Gonzalez, Alejandro",
    );
    expect(gonzalez?.category).toBe("S");
    expect(gonzalez?.shooter.region).toBe("ARG");
    // ICS=RO no se persiste hoy en match_entry, pero no debe ensuciar el nombre
  });

  it("marca isDq cuando matchPoints = 0", () => {
    const parsed = parseWinmssText(pages(overallPistolaPage));
    const dq = parsed.matchEntries.find(
      (e) => e.shooter.fullName === "ELIZALDE, Luciano",
    );
    expect(dq?.isDq).toBe(true);
    expect(dq?.matchPoints).toBe(0);
  });

  it("agrega entries de varias divisiones en el mismo PDF", () => {
    const parsed = parseWinmssText(
      pages(overallClassicPage, overallOpenPage, overallPistolaPage),
    );
    const codes = new Set(parsed.matchEntries.map((e) => e.divisionCode));
    expect(codes.has("CL")).toBe(true);
    expect(codes.has("O")).toBe(true);
    expect(codes.has("PIS")).toBe(true);
  });

  it("sin stages cuando es archivo overall puro", () => {
    const parsed = parseWinmssText(pages(overallClassicPage));
    expect(parsed.stages).toEqual([]);
  });

  it("extrae el club del título (token uppercase al inicio)", () => {
    // "TFABA 1er SOCIAL ESCOPETA" → region debería ser "TFABA"
    const parsed = parseWinmssText(pages(overallClassicPage));
    expect(parsed.region).toBe("TFABA");
  });

  it("dedupea título duplicado en la misma línea", () => {
    // El primer page tiene "TFABA 1er SOCIAL ESCOPETA TFABA 1er SOCIAL ESCOPETA"
    const parsed = parseWinmssText(pages(overallClassicPage));
    expect(parsed.name).toBe("TFABA 1er SOCIAL ESCOPETA");
    expect(parsed.name).not.toContain("TFABA 1er SOCIAL ESCOPETA TFABA");
  });

  it("dedupea título repetido 4× sin espacios entre repeticiones", () => {
    // Caso real visto con `unpdf`: el título aparece concatenado 4 veces
    // sin separador, terminando en "ESCOPETATFABA..." dentro de la misma línea.
    const quadrupled = `OPEN -- Overall Match Results
TFABA 1er SOCIAL ESCOPETATFABA 1er SOCIAL ESCOPETATFABA 1er SOCIAL ESCOPETATFABA 1er SOCIAL ESCOPETA Printed mayo 2, 2026 at 16:17
% Points CompetitorCompetitor Cat Reg Cls Tag ICS
1 100,00 100,0000 1 Doe, John ARG
World Classification System used Page 1`;
    const parsed = parseWinmssText(pages(quadrupled));
    expect(parsed.name).toBe("TFABA 1er SOCIAL ESCOPETA");
  });
});

describe("parseWinmssText — stages", () => {
  it("parsea un stage con sus results", () => {
    const parsed = parseWinmssText(pages(stageOpenStage1Page));
    expect(parsed.matchEntries).toEqual([]);
    expect(parsed.stages.length).toBe(1);
    expect(parsed.stages[0]?.stageNumber).toBe(1);
    expect(parsed.stages[0]?.results.length).toBe(5);
  });

  it("extrae stage_points, stage_percentage, place, hit_factor", () => {
    const parsed = parseWinmssText(pages(stageOpenStage1Page));
    const winner = parsed.stages[0]?.results.find(
      (r) => r.shooter.fullName === "GARNICA RIVEROS, Jorge Efrain",
    );
    expect(winner?.place).toBe(1);
    expect(winner?.stagePoints).toBe(110);
    expect(winner?.stagePercentage).toBe(100);
    expect(winner?.hitFactor).toBeCloseTo(5.2936, 4);
    expect(winner?.timeSeconds).toBeCloseTo(20.78, 2);
    expect(winner?.points).toBe(110); // ptsHit
  });

  it("marca isDq cuando hit_factor = 0", () => {
    const parsed = parseWinmssText(pages(stageOpenStage1Page));
    const dq = parsed.stages[0]?.results.find(
      (r) => r.shooter.fullName === "Romano, Christian",
    );
    expect(dq?.isDq).toBe(true);
    expect(dq?.stagePoints).toBe(0);
    expect(dq?.hitFactor).toBeNull();
    // place=0 para DQs (queda al final del ranking)
    expect(dq?.place).toBe(0);
  });

  it("agrega results de varias divisiones bajo el mismo stage_number", () => {
    const parsed = parseWinmssText(
      pages(stageOpenStage1Page, stagePccStage1Page),
    );
    expect(parsed.stages.length).toBe(1);
    const stage1 = parsed.stages[0]!;
    const codes = new Set(stage1.results.map((r) => r.divisionCode));
    expect(codes.has("O")).toBe(true);
    expect(codes.has("PCCO")).toBe(true);
  });

  it("crea stages distintos por stage_number", () => {
    const parsed = parseWinmssText(
      pages(stageOpenStage1Page, stageOpenStage2Page),
    );
    expect(parsed.stages.length).toBe(2);
    expect(parsed.stages[0]?.stageNumber).toBe(1);
    expect(parsed.stages[1]?.stageNumber).toBe(2);
  });

  it("ignora páginas con división desconocida sin romper el resto", () => {
    const unknownDivPage = `FOOBAR -- Overall Stage Results
TFABA 1er SOCIAL ESCOPETA Printed mayo 2, 2026 at 16:17
Stage 1 -- Etapa 1
PTS TIME FACTOR POINTS PERCENT # Name
HIT STAGE STAGE COMPETITOR
1 110 20,00 5,5000 110,0000 100,00 99 FOO, Bar
Page 1`;
    const parsed = parseWinmssText(
      pages(stageOpenStage1Page, unknownDivPage),
    );
    // La página FOOBAR se ignora; OPEN sigue parseando
    expect(parsed.stages[0]?.results.length).toBe(5);
    const codes = new Set(parsed.stages[0]?.results.map((r) => r.divisionCode));
    expect(codes.has("O")).toBe(true);
    expect(codes.size).toBe(1);
  });
});

describe("parseWinmssText — errores", () => {
  it("lanza error si el PDF está vacío", () => {
    expect(() => parseWinmssText([])).toThrow(/vac/i);
  });

  it("lanza error si no se encuentra el nombre del match", () => {
    const noTitlePage = `OPEN -- Overall Match Results
Printed mayo 2, 2026 at 16:17
% Points CompetitorCompetitor Cat Reg Cls Tag ICS
1 100,00 100,0000 1 Doe, John
World Classification System used Page 1`;
    expect(() => parseWinmssText(pages(noTitlePage))).toThrow(/nombre/i);
  });

  it("lanza error si no se extrae ninguna fila (PDF column-major roto)", () => {
    // Caso real: unpdf extrae las celdas column-major y produce líneas con
    // headers concatenados ("PointsPointsPointsPoints%%%%..."). Las regex
    // de fila no matchean, el resultado es matchEntries=[] y stages=[].
    // Antes generaba un match vacío con título garbage — ahora lanza error.
    const columnMajorPage = `OPEN -- Overall Match Results
PointsPointsPointsPoints%%%% CompetitorCompetitorCompetitorCompetitor RegRegRegRegCatCatCatCat TagTagTagTag ICSICSICSICSClsClsClsCls
Printed mayo 8, 2026 at 14:12
World Classification System used Page 1`;
    expect(() => parseWinmssText(pages(columnMajorPage))).toThrow(/fila/i);
  });

  it("lanza error si no se encuentra la fecha", () => {
    const noDatePage = `OPEN -- Overall Match Results
Some Match
% Points CompetitorCompetitor Cat Reg Cls Tag ICS
1 100,00 100,0000 1 Doe, John
World Classification System used Page 1`;
    expect(() => parseWinmssText(pages(noDatePage))).toThrow(/fecha/i);
  });

  it("acepta meses en español: enero a diciembre", () => {
    const inEnero = stageOpenStage1Page.replace("mayo 2", "enero 15");
    const parsed = parseWinmssText(pages(inEnero));
    expect(parsed.date).toBe("2026-01-15");

    const inDiciembre = stageOpenStage1Page.replace("mayo 2", "diciembre 31");
    const parsed2 = parseWinmssText(pages(inDiciembre));
    expect(parsed2.date).toBe("2026-12-31");
  });
});
