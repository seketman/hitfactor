import { describe, expect, it } from "vitest";
import { expectParserError } from "./helpers/expect-parser-error";
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

describe("parseWinmssText — puntos con separador de miles", () => {
  // Regresión del match "CENTRO REPUBLICA CHALLENGE 2026 BY GR PCC Edition".
  // Con 24 stages el overall pasa los 1000 puntos y ESS lo formatea como
  // "2,061.3283". El regex de fila pedía `\d+[.,]\d+`, así que NINGUNA fila
  // con puntaje de 4 dígitos matcheaba — y como las filas DQ van por otro
  // regex (sin columna de puntos), el match se importaba con el DQ como
  // único tirador. El import no fallaba: entraba casi vacío.
  const pccOverall = `CENTRO REPUBLICA CHALLENGE 2026 BY GR PCC Edition - Handgun
Printed: Jul 27, 2026 12:20:57
PC OPTICS - Results Overall
% Points Competitor Cat Reg Cls Tag ICS
1 100.00 2,061.3283 129 MAFFEI, Diego Andres S ARG OC
2 93.08 1,918.6773 91 REVOL, José Augusto ARG
10 52.41 1,080.4331 136 PACHECO, Maximiliano Andres ARG OC
89 MIGUELES CORDOBA, Max DQ
Printed Jul 27, 2026 12:20:57 ESS - Electronic Scoring System 1 of 1`;

  it("parsea las filas con puntaje de miles, no solo la del DQ", () => {
    const parsed = parseWinmssText(pages(pccOverall));
    expect(parsed.matchEntries).toHaveLength(4);
    expect(parsed.matchEntries.filter((e) => e.isDq)).toHaveLength(1);
  });

  it("interpreta la coma como separador de miles cuando hay punto decimal", () => {
    const parsed = parseWinmssText(pages(pccOverall));
    const maffei = parsed.matchEntries.find((e) =>
      e.shooter.fullName.includes("MAFFEI"),
    );
    expect(maffei?.matchPoints).toBeCloseTo(2061.3283, 4);
    expect(maffei?.matchPercentage).toBeCloseTo(100, 2);
    // Con el bug, matchPoints daba 0 y la entry quedaba marcada como ausente.
    expect(maffei?.isAbsent).toBe(false);
  });

  it("no rompe el formato WinMSS clásico con coma decimal", () => {
    const parsed = parseWinmssText(pages(overallOpenPage));
    expect(parsed.matchEntries[0]?.matchPoints).toBeCloseTo(482.0527, 4);
    expect(parsed.matchEntries[0]?.matchPercentage).toBeCloseTo(100, 2);
  });

  it("resuelve PC OPTICS a la división PCCO", () => {
    const parsed = parseWinmssText(pages(pccOverall));
    expect(parsed.matchEntries[0]?.divisionCode).toBe("PCCO");
  });
});

describe("parseWinmssText — frenar imports parciales", () => {
  // El modo de falla que dejó el match del PCC con un solo tirador: el
  // parser leyó ALGO, así que ninguna de las guardas existentes saltó, y el
  // import terminó con pantalla de éxito y el match casi vacío.
  //
  // Fila con forma de resultado pero shape que no soportamos (le falta la
  // columna de puntos): place, %, dorsal, nombre.
  const conFilaIlegible = `TORNEO DE PRUEBA - Handgun
Printed: Jul 27, 2026 12:20:57
PC OPTICS - Results Overall
% Points Competitor Cat Reg Cls Tag ICS
1 100.00 500.0000 129 MAFFEI, Diego Andres S ARG
2 95.50 91 REVOL, José Augusto ARG
Printed Jul 27, 2026 12:20:57 ESS - Electronic Scoring System 1 of 1`;

  it("tira si quedaron filas de datos sin leer, en vez de importar a medias", () => {
    expectParserError(
      () => parseWinmssText(pages(conFilaIlegible)),
      "partialRows",
    );
  });

  it("el error dice qué página y cuántas filas se perdieron", () => {
    expectParserError(
      () => parseWinmssText(pages(conFilaIlegible)),
      "partialRows",
      { detail: "página 1: leímos 1 de 2 filas" },
    );
  });

  // Guarda contra la heurística ingenua de "la página trajo solo DQs".
  // Una división con un solo tirador que se fue DQ es rara pero legítima, y
  // frenar ahí sería un falso positivo. Las filas DQ no tienen forma de
  // fila de datos (después del dorsal viene una letra), así que no cuentan.
  const soloDq = `TORNEO CHICO - Handgun
Printed: Jul 27, 2026 12:20:57
PC OPTICS - Results Overall
% Points Competitor Cat Reg Cls Tag ICS
89 MIGUELES CORDOBA, Max DQ
Printed Jul 27, 2026 12:20:57 ESS - Electronic Scoring System 1 of 1`;

  it("no frena una división cuyo único tirador se fue DQ", () => {
    const parsed = parseWinmssText(pages(soloDq));
    expect(parsed.matchEntries).toHaveLength(1);
    expect(parsed.matchEntries[0]?.isDq).toBe(true);
  });

  it("no frena un archivo que se lee entero", () => {
    expect(() => parseWinmssText(pages(overallOpenPage))).not.toThrow();
    expect(() => parseWinmssText(pages(stageOpenStage1Page))).not.toThrow();
  });

  // Un título que arranca con dos números pasa el primer filtro ("2026 3")
  // sin ser una fila. Si contara como candidato, un torneo con nombre así
  // rompería el import entero — por eso además se exige la coma.
  const tituloNumerico = `2026 3RA FECHA COPA SOCIAL - Handgun
Printed: Jul 27, 2026 12:20:57
PC OPTICS - Results Overall
% Points Competitor Cat Reg Cls Tag ICS
1 100.00 500.0000 129 MAFFEI, Diego Andres S ARG
Printed Jul 27, 2026 12:20:57 ESS - Electronic Scoring System 1 of 1`;

  it("no confunde un título que arranca con dos números con una fila perdida", () => {
    expect(() => parseWinmssText(pages(tituloNumerico))).not.toThrow();
    expect(parseWinmssText(pages(tituloNumerico)).matchEntries).toHaveLength(1);
  });
});

describe("parseWinmssText — footer 'User Defined Classification used'", () => {
  // Bug encontrado con el PDF de NOCTURNO ABRIL ATGQ 2026 (Quilmes): el
  // club usa una tabla de clasificación custom y el footer pasa a ser
  // "User Defined Classification used" en vez del estándar "World
  // Classification System used". Si no lo stripeamos, gana como candidato
  // a título por ser más largo que el nombre real.
  const userDefinedPage = `CLASSIC -- Overall Match Results
NOCTURNO ABRIL ATGQ 2026
Printed abril 30, 2026 at 23:39
% Points Competitor Cat Reg Cls Tag ICS
1 100,00 366,8255 38 GRADALSKI, Victor Martin ARG
2 86,11 315,8691 27 PINTOS, Gustavo S ARG
User Defined Classification used Page 1`;

  it("strippea el footer custom y extrae el título real", () => {
    const parsed = parseWinmssText(pages(userDefinedPage));
    expect(parsed.name).toBe("NOCTURNO ABRIL ATGQ 2026");
  });
});

describe("parseWinmssText — formato TF Lomas de Zamora (título arranca con dígito)", () => {
  // Variante de WinMSS clásico donde el club nombra el match como "3RA
  // FECHA COPA SOCIAL" — el título arranca con un dígito. Antes el filtro
  // /^\d/ de extractMatchName lo descartaba como si fuera fila de datos.
  // El resto del formato es idéntico al WinMSS clásico (mes inglés en
  // "Printed May 6, 2026 at 6:36", decimales con punto, footer "World
  // Classification System used").
  const lomasOpenPage = `OPEN -- Overall Match Results
3RA FECHA COPA SOCIAL
Printed May 6, 2026 at 6:36
% Points Competitor Cat Reg Cls Tag ICS
1 100.00 640.0000 14 Disanti, Thomas Diego ARG C
2 82.75 529.5751 46 Pereyra, Esteban Emilio ARG B
3 77.54 496.2763 31 Hay Chaia, Matias ARG
World Classification System used Page 1`;

  it("detecta el formato como WinMSS válido", () => {
    expect(isWinmssFormat(lomasOpenPage)).toBe(true);
  });

  it("extrae título que arranca con dígito ('3RA FECHA COPA SOCIAL')", () => {
    const parsed = parseWinmssText(pages(lomasOpenPage));
    expect(parsed.name).toBe("3RA FECHA COPA SOCIAL");
  });

  it("extrae fecha del 'Printed' (mes en inglés, formato 'May 6, 2026')", () => {
    const parsed = parseWinmssText(pages(lomasOpenPage));
    expect(parsed.date).toBe("2026-05-06");
  });

  it("parsea filas con decimales en punto", () => {
    const parsed = parseWinmssText(pages(lomasOpenPage));
    expect(parsed.matchEntries).toHaveLength(3);
    const winner = parsed.matchEntries[0];
    expect(winner?.shooter.fullName).toBe("Disanti, Thomas Diego");
    expect(winner?.matchPercentage).toBe(100);
    expect(winner?.matchPoints).toBe(640);
    expect(winner?.divisionCode).toBe("O");
  });
});

describe("parseWinmssText — página de Disqualified Shooters (WinMSS clásico)", () => {
  // WinMSS genera una página aparte con la lista final de DQs cuando hay
  // al menos uno. Formato típico: `<bib> <División (1-2 palabras)>
  // <Apellido>, <Nombre>`. La división aparece en cada fila (no en
  // section header) y los nombres vienen en title case ("Production",
  // "PCC Optic"), no en uppercase.
  const lomasOverallPage = `OPEN -- Overall Match Results
3RA FECHA COPA SOCIAL
Printed May 6, 2026 at 6:36
% Points Competitor Cat Reg Cls Tag ICS
1 100.00 640.0000 14 Disanti, Thomas Diego ARG C
World Classification System used Page 1`;

  const dqPage = `Printed May 6, 2026 at 6:36
3RA FECHA COPA SOCIAL
Disqualified Shooters
No. Division Name
51 Production Prieto, Gonzalo Martin
1 Disqualifications
Page 1 of 1`;

  it("parsea fila '<bib> Production <Apellido>, <Nombre>'", () => {
    const parsed = parseWinmssText(pages(lomasOverallPage, dqPage));
    const dq = parsed.matchEntries.find((e) => e.isDq);
    expect(dq).toBeDefined();
    expect(dq?.shooter.fullName).toBe("Prieto, Gonzalo Martin");
    expect(dq?.divisionCode).toBe("P");
    expect(dq?.place).toBe(0);
    expect(dq?.matchPoints).toBe(0);
  });

  it("resuelve división multi-palabra (greedy '<bib> Production Optics <Apellido>, <Nombre>')", () => {
    const dqMulti = `Printed May 6, 2026 at 6:36
3RA FECHA COPA SOCIAL
Disqualified Shooters
No. Division Name
7 Production Optics Lagunas Labarca, Leoncio Arturo
1 Disqualifications
Page 1 of 1`;
    const parsed = parseWinmssText(pages(lomasOverallPage, dqMulti));
    const dq = parsed.matchEntries.find((e) => e.isDq);
    expect(dq?.shooter.fullName).toBe("Lagunas Labarca, Leoncio Arturo");
    expect(dq?.divisionCode).toBe("PO");
  });

  it("la página DQ no rompe el nombre/fecha del match (vienen de páginas overall previas)", () => {
    const parsed = parseWinmssText(pages(lomasOverallPage, dqPage));
    expect(parsed.name).toBe("3RA FECHA COPA SOCIAL");
    expect(parsed.date).toBe("2026-05-06");
  });

  it("ignora líneas que no son filas de DQ (header, footer, '1 Disqualifications')", () => {
    const parsed = parseWinmssText(pages(lomasOverallPage, dqPage));
    // Solo el shooter DQ, no "Disqualifications" como entry fantasma.
    const dqs = parsed.matchEntries.filter((e) => e.isDq);
    expect(dqs).toHaveLength(1);
  });
});

describe("parseWinmssText — título corto pierde contra distractores largos", () => {
  // Bug reproducido con el match "SOCIAL DOMINGO" (TFABA, 17/05/26):
  // título de 14 chars. En el PDF de stages la página 1 tiene "SOCIAL
  // DOMINGO" seguido de "Stage 1 -- LA UNO" (17 chars), y en la última
  // página la fila DQ "21 Production Optics Echeverria, Guillermo Ramon"
  // (~48 chars). Con la heurística vieja "el más largo gana", el extractor
  // elegía cualquiera de esos en vez del título real, y el resolver de
  // stages no encontraba el match en DB.
  //
  // Fix: la posición es la señal — el título siempre aparece arriba de la
  // página, antes de cualquier "Stage N" o tabla de DQs.
  // El orden de líneas refleja la salida real de unpdf: el header de
  // división va PRIMERO (arriba del PDF), después el título, después
  // "Printed". El "Stage 1 -- LA UNO" sin "Etapa" no entra en el strip
  // pattern existente y queda como candidato más largo (17 chars vs
  // "SOCIAL DOMINGO" 14).
  const socialDomingoStagePage = `PCC OPTIC -- Overall Stage Results
SOCIAL DOMINGO
Printed May 17, 2026 at 13:41
Stage 1 -- LA UNO
PTS TIME FACTOR POINTS PERCENT # Name
HIT STAGE STAGE COMPETITOR
1 37 4.79 7.7244 45.0000 100.00 44 Ortiz, Facundo Maximil
2 26 5.13 5.0682 29.5258 65.61 57 Salomone, Juan Pablo
Page 1`;

  // La página DQ del WinMSS clásico: la fila "21 Production Optics
  // Echeverria, Guillermo Ramon" (~48 chars) no la filtra el regex
  // `^\s*\d+\s+\d` (después de "21 " viene "P", no dígito), y antes
  // ganaba como candidato más largo contra "SOCIAL DOMINGO".
  const socialDomingoDqPage = `SOCIAL DOMINGO
Printed May 17, 2026 at 13:41
Disqualified Shooters
No. Division Name
21 Production Optics Echeverria, Guillermo Ramon
1 Disqualifications
Page 1 of 1`;

  it("elige el título corto sobre 'Stage N -- NOMBRE' más largo", () => {
    const parsed = parseWinmssText(pages(socialDomingoStagePage));
    expect(parsed.name).toBe("SOCIAL DOMINGO");
  });

  it("el título sobrevive aun cuando la página DQ trae filas muy largas", () => {
    const parsed = parseWinmssText(
      pages(socialDomingoStagePage, socialDomingoDqPage),
    );
    expect(parsed.name).toBe("SOCIAL DOMINGO");
  });
});

describe("parseWinmssText — formato ESS by-Stage", () => {
  // Tercer formato: PDFs de stages generados por ESS. Diferencias clave:
  //  - Header: "X - Results by Stage" (no "Stage Results" ni "Stage N")
  //  - Subheader: "Stage <Division> - Stage NN" (nombre de div + número)
  //  - Filas de 5 columnas (place, %, points, bib, name) — sin raw hits,
  //    time ni hit factor (no las expone ESS en este reporte).
  const essByStage01 = `TFABA - 19 - SEGUNDO SOCIAL PISTOLA 9 MAYO 2026 - Handgun
Printed: May 11, 2026 21:34:08
CLASSIC - Results by Stage
Stage Classic - Stage 01
% Points Competitor Cat Reg Cls Tag ICS
1 100.00 155.0000 58 SILVA, Lucas ARG
2 79.04 122.5174 51 FAVAREL, Leandro Carlos ARG
Printed May 11, 2026 21:34:08 ESS`;

  const essByStage02 = `TFABA - 19 - SEGUNDO SOCIAL PISTOLA 9 MAYO 2026 - Handgun
Printed: May 11, 2026 21:34:08
CLASSIC - Results by Stage
Stage Classic - Stage 02
% Points Competitor Cat Reg Cls Tag ICS
1 100.00 80.0000 51 FAVAREL, Leandro Carlos ARG
2 65.00 52.0000 58 SILVA, Lucas ARG
Printed May 11, 2026 21:34:08 ESS`;

  it("detecta el formato como WinMSS válido", () => {
    expect(isWinmssFormat(essByStage01)).toBe(true);
  });

  it("extrae stage_number del subheader 'Stage Classic - Stage 01'", () => {
    const parsed = parseWinmssText(pages(essByStage01));
    expect(parsed.stages).toHaveLength(1);
    expect(parsed.stages[0]?.stageNumber).toBe(1);
  });

  it("agrupa múltiples stages bajo el mismo match", () => {
    const parsed = parseWinmssText(pages(essByStage01, essByStage02));
    expect(parsed.stages).toHaveLength(2);
    expect(parsed.stages.map((s) => s.stageNumber)).toEqual([1, 2]);
  });

  it("parsea filas de 5 columnas (sin raw hits/time/factor)", () => {
    const parsed = parseWinmssText(pages(essByStage01));
    const results = parsed.stages[0]?.results ?? [];
    expect(results).toHaveLength(2);
    const winner = results.find((r) => r.shooter.fullName === "SILVA, Lucas");
    expect(winner?.stagePercentage).toBe(100);
    expect(winner?.stagePoints).toBe(155);
    expect(winner?.place).toBe(1);
    // ESS by-stage no expone estos campos — quedan null.
    expect(winner?.points).toBeNull();
    expect(winner?.timeSeconds).toBeNull();
    expect(winner?.hitFactor).toBeNull();
  });

  it("extrae el título del match limpiando subheaders ESS", () => {
    const parsed = parseWinmssText(pages(essByStage01));
    expect(parsed.name).toBe(
      "TFABA - 19 - SEGUNDO SOCIAL PISTOLA 9 MAYO 2026 - Handgun",
    );
  });

  it("toma la división del header 'CLASSIC - Results by Stage'", () => {
    const parsed = parseWinmssText(pages(essByStage01));
    expect(parsed.stages[0]?.results[0]?.divisionCode).toBe("CL");
  });
});

describe("parseWinmssText — formato ESS 'Overall Stage Results' (guion simple)", () => {
  // Cuarto formato (caso TFVM - 1er Social 2026 - Handgun): PDF de stages ESS
  // que usa header de GUION SIMPLE "CLASSIC - Overall Stage Results" (no `--`
  // ni "Results by Stage") + subheader PELADO "Stage 01" (cero-padded, sin
  // "Etapa" ni "Stage <div> - Stage NN"). Las filas son de 8 columnas como el
  // WinMSS clásico: place, points, time, hitFactor, stagePts, stage%, bib,
  // nombre; decimales con punto.
  const essOverallStage01 = `TFVM - 1er Social 2026 - Handgun
Printed: Jul 05, 2026 22:07:22
CLASSIC - Overall Stage Results
Stage 01
Points Time Hit Factor Stage Pts Stage % # Competitor Name
1 87 20.52 4.2398 105.0000 100.00 21 LOBOS, Santiago Francisco
Printed Jul 05, 2026 22:07:22 ESS - Electronic Scoring System 1 of 36`;

  const essOverallStage02 = `TFVM - 1er Social 2026 - Handgun
Printed: Jul 05, 2026 22:07:22
PRODUCTION - Overall Stage Results
Stage 02
Points Time Hit Factor Stage Pts Stage % # Competitor Name
1 104 22.66 4.5896 120.0000 100.00 1 BAILONE, Jonathan David
2 97 23.96 4.0484 105.8505 88.21 11 VILLANUEVA, Enrique
Printed Jul 05, 2026 22:07:22 ESS - Electronic Scoring System 8 of 36`;

  it("detecta el formato como WinMSS válido", () => {
    expect(isWinmssFormat(essOverallStage01)).toBe(true);
  });

  it("extrae nombre y fecha del match (no tira 'no se pudo extraer el nombre')", () => {
    const parsed = parseWinmssText(pages(essOverallStage01));
    expect(parsed.name).toBe("TFVM - 1er Social 2026 - Handgun");
    expect(parsed.date).toBe("2026-07-05");
  });

  it("extrae el stage_number del subheader pelado 'Stage 01'", () => {
    const parsed = parseWinmssText(pages(essOverallStage01, essOverallStage02));
    expect(parsed.stages.map((s) => s.stageNumber)).toEqual([1, 2]);
  });

  it("mapea la división del header de guion simple", () => {
    const parsed = parseWinmssText(pages(essOverallStage01, essOverallStage02));
    expect(parsed.stages[0]?.results[0]?.divisionCode).toBe("CL");
    expect(parsed.stages[1]?.results[0]?.divisionCode).toBe("P");
  });

  it("parsea las 8 columnas del stage (points/time/factor/stagePts/%)", () => {
    const parsed = parseWinmssText(pages(essOverallStage01));
    const r = parsed.stages[0]?.results[0];
    expect(r?.shooter.fullName).toBe("LOBOS, Santiago Francisco");
    expect(r?.points).toBe(87);
    expect(r?.timeSeconds).toBe(20.52);
    expect(r?.hitFactor).toBe(4.2398);
    expect(r?.stagePoints).toBe(105);
    expect(r?.stagePercentage).toBe(100);
    expect(r?.place).toBe(1);
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

  it("mapea 'PCC IRON' (WinMSS clásico) → PCC", () => {
    // Bug reproducido: el match TFABA 3er Social PCC 30 MAY 26 (WinMSS
    // clásico, no ESS) incluía secciones "PCC IRON -- Overall Match
    // Results" y "PCC OPTIC -- Overall Match Results". El map sólo tenía
    // entradas para la variante ESS ("PC IRON" / "PC OPTICS"), así que
    // la sección "PCC IRON" se descartaba silenciosamente y sólo entraba
    // PCCO. El fix agrega "PCC IRON" → "PCC".
    const pccIronPage = overallClassicPage.replace(
      "SG CLASSIC -- Overall Match Results",
      "PCC IRON -- Overall Match Results",
    );
    const parsed = parseWinmssText(pages(pccIronPage));
    expect(parsed.matchEntries[0]?.divisionCode).toBe("PCC");
    expect(parsed.matchEntries.length).toBe(3);
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

  it("marca isAbsent (no isDq) cuando matchPoints = 0 en una fila normal", () => {
    // WinMSS lista los DQs explícitamente en una página separada
    // (parseDqPageRows). Una fila del listado overall con 0 puntos casi
    // siempre es un tirador anotado que no se presentó — no es DQ.
    const parsed = parseWinmssText(pages(overallPistolaPage));
    const entry = parsed.matchEntries.find(
      (e) => e.shooter.fullName === "ELIZALDE, Luciano",
    );
    expect(entry?.isDq).toBe(false);
    expect(entry?.isAbsent).toBe(true);
    expect(entry?.matchPoints).toBe(0);
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
    expectParserError(() => parseWinmssText([]), "emptyPdf");
  });

  it("lanza error si no se encuentra el nombre del match", () => {
    const noTitlePage = `OPEN -- Overall Match Results
Printed mayo 2, 2026 at 16:17
% Points CompetitorCompetitor Cat Reg Cls Tag ICS
1 100,00 100,0000 1 Doe, John
World Classification System used Page 1`;
    expectParserError(
      () => parseWinmssText(pages(noTitlePage)),
      "noWinmssMatchName",
    );
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
    expectParserError(
      () => parseWinmssText(pages(columnMajorPage)),
      "winmssNoRows",
    );
  });

  it("lanza error si no se encuentra la fecha", () => {
    const noDatePage = `OPEN -- Overall Match Results
Some Match
% Points CompetitorCompetitor Cat Reg Cls Tag ICS
1 100,00 100,0000 1 Doe, John
World Classification System used Page 1`;
    expectParserError(
      () => parseWinmssText(pages(noDatePage)),
      "noPrintedDate",
    );
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

// ---------------------------------------------------------------------------
// Tokens de la columna Tag (MD, RM, ST, ASM) que antes bloqueaban la
// pasada de strip y dejaban "S ARG MD" pegado al nombre.
// ---------------------------------------------------------------------------

describe("parseWinmssText — Tags de organización del torneo", () => {
  // Fila real del PDF "1er Ranking Social 2026" — PRODUCTION OPTICS:
  //   2 86,11 467,2091 1 CAPRA, Claudio Alberto S ARG MD
  // Sin reconocer MD, el parser frenaba en MD y dejaba "CAPRA, Claudio
  // Alberto S ARG MD" como `fullName`, creando un shooter duplicado al
  // re-importar.
  const pageWithMdTag = `PRODUCTION OPTICS -- Overall Match Results
1er Ranking Social 2026 Printed marzo 28, 2026 at 17:43
% Points CompetitorCompetitor Cat Reg Cls Tag ICS
1 100,00 542,5598 16 LARROUDE, Javier ARG RO
2 86,11 467,2091 1 CAPRA, Claudio Alberto S ARG MD
World Classification System used Page 1`;

  it("pela el tag 'MD' (Match Director) y deja el nombre limpio", () => {
    const parsed = parseWinmssText([{ num: 1, text: pageWithMdTag }]);
    const capra = parsed.matchEntries.find((e) =>
      e.shooter.fullName.toLowerCase().includes("capra"),
    );
    expect(capra).toBeDefined();
    expect(capra!.shooter.fullName).toBe("CAPRA, Claudio Alberto");
    // El "S" (Senior) que antes quedaba pegado, ahora se identifica como
    // categoría y se persiste en el campo correcto.
    expect(capra!.category).toBe("S");
    expect(capra!.shooter.region).toBe("ARG");
  });

  it("LARROUDE (sin tag, solo región y RO) sigue parseándose igual", () => {
    const parsed = parseWinmssText([{ num: 1, text: pageWithMdTag }]);
    const larroude = parsed.matchEntries.find((e) =>
      e.shooter.fullName.toLowerCase().includes("larroude"),
    );
    expect(larroude!.shooter.fullName).toBe("LARROUDE, Javier");
    expect(larroude!.shooter.region).toBe("ARG");
  });

  it("también pela 'ST' (Stats) — visto en producción para 'ZAPPULLA'", () => {
    const pageWithSt = pageWithMdTag.replace(
      "1 CAPRA, Claudio Alberto S ARG MD",
      "1 ZAPPULLA, Marcio ARG ST",
    );
    const parsed = parseWinmssText([{ num: 1, text: pageWithSt }]);
    const z = parsed.matchEntries.find((e) =>
      e.shooter.fullName.toLowerCase().includes("zappulla"),
    );
    expect(z!.shooter.fullName).toBe("ZAPPULLA, Marcio");
    expect(z!.shooter.region).toBe("ARG");
  });
});
