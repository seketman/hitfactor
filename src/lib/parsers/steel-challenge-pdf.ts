import { DISCIPLINE } from "../disciplines";
import type {
  ParsedMatch,
  ParsedMatchEntry,
  ParsedShooter,
  ParsedStage,
  ParsedStageResult,
} from "../types/match";
import type { PdfPage } from "./pdf-extract";
import {
  extractClubFromTitle,
  stripDqPrefix,
  stripNameSuffixes,
} from "./shared";

/**
 * Parser para reportes PDF de Steel Challenge generados por PractiScore
 * iPhone (2.3.11+ aprox). Acepta múltiples PDFs por import — el flow
 * típico es:
 *   - Un PDF "Stage Results - By Division" por cada stage.
 *   - Opcional: PDFs "Category Leaders - <División>" (se ignoran: la info
 *     útil está repetida en los Stage Results, y los Category Leaders
 *     particionan por categoría — sus % son por-categoría, no overall).
 *
 * Estrategia:
 *  1. Identificamos los archivos Stage Results.
 *  2. De cada uno extraemos las secciones por división (ej "Pcc - Stage 1
 *     (Cancha 3)", "Pistola - Stage 1 (Cancha 3)").
 *  3. Por cada sección armamos los stage_results (place, time, %).
 *  4. Computamos el overall del match sumando los tiempos por (tirador,
 *     división): el ganador de cada división es el menor totalTime; los
 *     demás se rankean por totalTime ascendente, % = winnerTime/myTime*100.
 *  5. Devolvemos un ParsedMatch con matchEntries (overall computado) +
 *     stages (uno por stage encontrado).
 *
 * Decisiones:
 *  - El nombre del match suele venir literal "Steel Challenge" en estos
 *    PDFs (el iPhone no incluye un nombre custom). Usamos el primer texto
 *    no-fecha del primer archivo como nombre.
 *  - La región queda null si no podemos extraer un club code del nombre
 *    (caso típico cuando el match no se llamó con un código de club).
 *  - DQs: no aparecen en estos PDFs típicamente, pero por defensiva
 *    aplicamos `stripDqPrefix` al parsear cada fila.
 *  - Si un tirador aparece en stage 1 pero no en stage 2 o 3, su totalTime
 *    queda como la suma de los stages donde aparece — lo marcamos como
 *    `isAbsent: true` si participó en menos stages que el máximo observado.
 */

/** Un archivo PDF ya extraído a páginas de texto. */
export interface SteelPdfFile {
  pages: PdfPage[];
  filename: string;
}

const TITLE_DATE_RE = /(\d{4}-\d{2}-\d{2})/;

// Cabecera de sección por división dentro de un Stage Results.
// Ej: "Pcc - Stage 1 (Cancha 3)", "Pistola - Stage 2 (Cancha 4)".
// `(Cancha N)` es opcional — la dejamos opcional para no romper si un
// match no usa esa convención.
const SECTION_HEADER_RE =
  /^([A-Za-zÁÉÍÓÚÑñáéíóú]+)\s*-\s*Stage\s+(\d+)\s*(?:\(([^)]+)\))?\s*$/;

// Cabecera de archivo "Category Leaders - <división>". Ej:
// "Category Leaders - Pistola", "Category Leaders - Pcc".
const CATEGORY_LEADERS_HEADER_RE =
  /^Category\s+Leaders\s*-\s*([A-Za-zÁÉÍÓÚÑñáéíóú]+)\s*$/;

// Cabecera de sub-bloque por categoría dentro de un Category Leaders.
// Ej: "Category: Deportivo", "Category: General".
const CATEGORY_BLOCK_RE = /^Category:\s*(.+)$/;

// Fila de datos de tirador. Capturamos solo lo que necesitamos:
//   place / nombre / time / %
// El resto de la fila (strings individuales con sus Raw/Penalty, TOD)
// queda fuera porque su layout varía según haya o no penalties por string
// y nuestro modelo de stage_result no las usa.
const ENTRY_ROW_RE = /^(\d+)\s+(.+?)\s+P\s+([\d.]+)\s+([\d.]+)(?:\s|$)/;

const FINAL_HEADER_RE = /^Final\b.*\bName\b/i;

/**
 * Mapeo de la etiqueta de división visible en el PDF al `code` que usamos
 * en la tabla `divisions` para Steel Challenge. Mantenemos las claves
 * normalizadas a MAYÚSCULAS y SIN tildes para que el match no dependa de
 * cómo PractiScore las muestre.
 */
const DIVISION_CODE_BY_LABEL: Record<string, string> = {
  PCC: "PCC",
  PISTOLA: "PISTOLA",
  OPEN: "OPEN",
  IRON: "IRON",
  OPTIC: "OPTIC",
  REVOLVER: "REVOLVER",
  ROOKIE: "ROOKIE",
};

function normalizeDivisionLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
}

function divisionCodeFromLabel(label: string): string {
  const norm = normalizeDivisionLabel(label);
  return DIVISION_CODE_BY_LABEL[norm] ?? norm;
}

/**
 * True si el texto extraído de un PDF (o de múltiples concatenados)
 * pertenece a un reporte Steel Challenge generado por PractiScore iPhone.
 *
 * Aceptamos los dos sub-formatos: "Stage Results - By Division" y
 * "Category Leaders -" — aunque el parser real solo usa los primeros.
 */
export function isSteelChallengePdfFormat(text: string): boolean {
  if (!/Steel\s+Challenge/i.test(text)) return false;
  if (/Stage\s+Results\s*-\s*By\s+Division/i.test(text)) return true;
  if (/Category\s+Leaders\s*-/i.test(text)) return true;
  return false;
}

/**
 * Parsea uno o más PDFs de Steel Challenge y devuelve el `ParsedMatch`
 * consolidado. Requiere al menos un archivo "Stage Results - By Division" —
 * los "Category Leaders" solos no alcanzan porque sus % son por-categoría
 * (no por-división) y no traen el ranking absoluto que necesitamos.
 *
 * Tira `Error` con un mensaje accionable si:
 *  - Ningún archivo es Stage Results.
 *  - No se pudo extraer la fecha del torneo.
 *  - Hay dos archivos cubriendo el mismo (división, stage) — sería data
 *    duplicada y no sabemos cuál creer.
 */
export function parseSteelChallengePdfs(files: SteelPdfFile[]): ParsedMatch {
  if (files.length === 0) {
    throw new Error("No se recibió ningún archivo para parsear.");
  }

  // Identificamos archivos que SÍ son Stage Results.
  const stageFiles = files.filter((f) => {
    const text = joinFileText(f);
    return /Stage\s+Results\s*-\s*By\s+Division/i.test(text);
  });

  if (stageFiles.length === 0) {
    throw new Error(
      "Subí los PDFs 'Stage Results - By Division' del torneo. Los " +
        "'Category Leaders' por sí solos no alcanzan: sus porcentajes son " +
        "por categoría y no traen el ranking absoluto de la división.",
    );
  }

  // Los archivos 'Category Leaders - <división>' SÍ traen la categoría de
  // cada tirador (Deportivo / General / etc.). Los parseamos aparte para
  // construir un mapa (divisionCode, name) → category que después usamos
  // al armar los matchEntries. Si no se subieron, todos los entries
  // quedan con category = null (estado válido).
  const categoryAssignments = new Map<string, string>();
  for (const file of files) {
    const text = joinFileText(file);
    if (!/Category\s+Leaders\s*-/i.test(text)) continue;
    for (const [key, category] of extractCategoryAssignments(file)) {
      // Si dos archivos asignan distintas categorías al mismo tirador, el
      // último gana — caso poco probable; los Category Leaders no se
      // superponen normalmente entre archivos del mismo torneo.
      categoryAssignments.set(key, category);
    }
  }

  // Nombre y fecha desde el primer archivo (todos los del mismo torneo
  // traen los mismos valores en las primeras líneas).
  const { name, date } = extractNameAndDate(stageFiles[0]!);
  if (!date) {
    throw new Error(
      "No pudimos extraer la fecha del torneo del PDF. Verificá que el " +
        "reporte arranque con 'Steel Challenge' seguido de la fecha en " +
        "formato YYYY-MM-DD.",
    );
  }

  // Acumulador de stages: keyed por stageNumber. Detectamos duplicados
  // (dos archivos cubriendo el mismo número de stage) y abortamos.
  const stagesByNumber = new Map<number, ParsedStage>();
  // Set de (divisionCode, stageNumber) ya vistos: si un archivo trae el
  // mismo (división, stage) que otro, es un dup y no sabemos cuál creer.
  const seenDivStage = new Set<string>();
  // shooterKey = `${divisionCode}|${normalizeName(name)}` → datos persistentes
  // del tirador (memberNumber y category, que toman el primer no-null visto).
  const shooterInfo = new Map<
    string,
    {
      shooter: ParsedShooter;
      divisionCode: string;
      category: string | null;
      classification: string | null;
    }
  >();
  // Sumario per-shooter para computar overall: tiempos por stage observados.
  const stageTimesByShooter = new Map<string, Map<number, number>>();

  for (const file of stageFiles) {
    const sections = extractStageSections(file);
    for (const section of sections) {
      const divKey = `${section.divisionCode}|${section.stageNumber}`;
      if (seenDivStage.has(divKey)) {
        throw new Error(
          `Hay dos archivos cubriendo el stage ${section.stageNumber} ` +
            `de ${section.divisionLabel}. Subí un solo PDF por stage.`,
        );
      }
      seenDivStage.add(divKey);

      let stage = stagesByNumber.get(section.stageNumber);
      if (!stage) {
        stage = {
          stageNumber: section.stageNumber,
          name: section.stageLabel ?? `Stage ${section.stageNumber}`,
          results: [],
        };
        stagesByNumber.set(section.stageNumber, stage);
      }

      for (const row of section.rows) {
        const key = `${section.divisionCode}|${normalizeName(row.name)}`;
        const shooter: ParsedShooter = {
          fullName: row.name,
          memberNumber: null,
          region: null,
        };
        if (!shooterInfo.has(key)) {
          shooterInfo.set(key, {
            shooter,
            divisionCode: section.divisionCode,
            category: categoryAssignments.get(key) ?? null,
            classification: null,
          });
        }

        const result: ParsedStageResult = {
          shooter,
          divisionCode: section.divisionCode,
          classification: null,
          powerFactor: null,
          points: null,
          penalties: null,
          timeSeconds: row.time,
          hitFactor: null,
          stagePoints: 0,
          stagePercentage: row.percentage,
          place: row.place,
          hits: null,
          isDq: row.isDq,
        };
        stage.results.push(result);

        if (!stageTimesByShooter.has(key)) {
          stageTimesByShooter.set(key, new Map());
        }
        stageTimesByShooter.get(key)!.set(section.stageNumber, row.time);
      }
    }
  }

  const stages = Array.from(stagesByNumber.values()).sort(
    (a, b) => (a.stageNumber ?? 0) - (b.stageNumber ?? 0),
  );

  // Cuántos stages distintos vimos en total — sirve para detectar tiradores
  // que no compitieron en todos (los marcamos como `isAbsent`).
  const stageNumbers = stages
    .map((s) => s.stageNumber)
    .filter((n): n is number => n !== null);
  const totalStages = stageNumbers.length;

  // Armamos overall por (división): suma de tiempos → ranking → %.
  // Agrupamos shooters por división primero para computar ranking dentro
  // de cada división.
  const shootersByDivision = new Map<
    string,
    Array<{ key: string; totalTime: number; stagesRun: number }>
  >();
  for (const [key, stageTimes] of stageTimesByShooter) {
    const info = shooterInfo.get(key)!;
    let total = 0;
    for (const t of stageTimes.values()) total += t;
    const list = shootersByDivision.get(info.divisionCode);
    if (list) {
      list.push({ key, totalTime: total, stagesRun: stageTimes.size });
    } else {
      shootersByDivision.set(info.divisionCode, [
        { key, totalTime: total, stagesRun: stageTimes.size },
      ]);
    }
  }

  const matchEntries: ParsedMatchEntry[] = [];
  for (const [, shooters] of shootersByDivision) {
    // Ranking: menor tiempo total = mejor. Tiradores que NO completaron
    // todos los stages quedan al final (no compiten por el ranking overall).
    const completed = shooters.filter((s) => s.stagesRun === totalStages);
    const incomplete = shooters.filter((s) => s.stagesRun !== totalStages);
    completed.sort((a, b) => a.totalTime - b.totalTime);

    const winnerTime = completed[0]?.totalTime ?? null;
    let place = 1;
    for (const s of completed) {
      const info = shooterInfo.get(s.key)!;
      matchEntries.push({
        shooter: info.shooter,
        divisionCode: info.divisionCode,
        classification: info.classification,
        powerFactor: null,
        category: info.category,
        place: place++,
        matchPoints: 0,
        matchPercentage:
          winnerTime && s.totalTime > 0
            ? (winnerTime / s.totalTime) * 100
            : 0,
        totalTimeSeconds: s.totalTime,
        hits: null,
        isDq: false,
        isAbsent: false,
      });
    }
    // Tiradores que se saltearon algún stage: los incluimos como ausentes
    // para que aparezcan en el match pero no contaminen el ranking.
    for (const s of incomplete) {
      const info = shooterInfo.get(s.key)!;
      matchEntries.push({
        shooter: info.shooter,
        divisionCode: info.divisionCode,
        classification: info.classification,
        powerFactor: null,
        category: info.category,
        place: 0,
        matchPoints: 0,
        matchPercentage: 0,
        totalTimeSeconds: s.totalTime > 0 ? s.totalTime : null,
        hits: null,
        isDq: false,
        isAbsent: true,
      });
    }
  }

  const region = extractClubFromTitle(name);

  return {
    discipline: DISCIPLINE.STEEL,
    source: "practiscore_steel_pdf",
    name,
    date,
    region,
    matchEntries,
    stages,
    generatedBy: null,
  };
}

// ---------------------------------------------------------------------------
// Helpers de extracción
// ---------------------------------------------------------------------------

interface ParsedSection {
  divisionCode: string;
  divisionLabel: string;
  stageNumber: number;
  stageLabel: string | null;
  rows: Array<{
    place: number;
    name: string;
    time: number;
    percentage: number;
    isDq: boolean;
  }>;
}

/**
 * Parsea las secciones "Pcc - Stage 1 (Cancha 3)" y similares de un
 * archivo Stage Results. Ignora líneas que no son ni encabezado ni dato.
 */
function extractStageSections(file: SteelPdfFile): ParsedSection[] {
  const text = joinFileText(file);
  const lines = text.split("\n").map((l) => l.trim());

  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  let inDataRows = false;

  for (const line of lines) {
    if (!line) continue;

    // ¿Es una cabecera de sección?
    const sectionMatch = SECTION_HEADER_RE.exec(line);
    if (sectionMatch) {
      if (current) sections.push(current);
      const [, divisionLabel, stageNumberStr, stageLabel] = sectionMatch;
      current = {
        divisionLabel,
        divisionCode: divisionCodeFromLabel(divisionLabel),
        stageNumber: parseInt(stageNumberStr, 10),
        stageLabel: stageLabel ?? null,
        rows: [],
      };
      inDataRows = false;
      continue;
    }

    if (!current) continue;

    // ¿Es la fila "Final Name USPSA# Division Time % ..."? Marca el inicio
    // de las filas de datos.
    if (FINAL_HEADER_RE.test(line)) {
      inDataRows = true;
      continue;
    }
    if (!inDataRows) continue;

    // ¿Fila de datos?
    const m = ENTRY_ROW_RE.exec(line);
    if (!m) continue;
    const [, placeStr, rawName, timeStr, pctStr] = m;
    const time = parseFloat(timeStr);
    const percentage = parseFloat(pctStr);
    if (!Number.isFinite(time) || !Number.isFinite(percentage)) continue;

    const { fullName: stripped, isDq } = stripDqPrefix(rawName);
    const cleanedName = stripNameSuffixes(stripped);
    current.rows.push({
      place: parseInt(placeStr, 10),
      name: cleanedName,
      time,
      percentage,
      isDq,
    });
  }
  if (current) sections.push(current);

  return sections;
}

/**
 * Parsea un archivo "Category Leaders - <división>" y devuelve un mapa
 * `${divisionCode}|${normalizedName}` → category extraídas. El archivo
 * trae sub-bloques "Category: X" cada uno seguido de un header de tabla
 * y N filas de tiradores. Cada tirador hereda la categoría del sub-bloque
 * más reciente. La división del archivo viene del header principal
 * ("Category Leaders - Pistola" → PISTOLA).
 *
 * Si el header de archivo no se reconoce (división rara), devolvemos un
 * mapa vacío — el archivo se ignora sin abortar el import.
 */
function extractCategoryAssignments(
  file: SteelPdfFile,
): Map<string, string> {
  const text = joinFileText(file);
  const lines = text.split("\n").map((l) => l.trim());

  let fileDivisionCode: string | null = null;
  let currentCategory: string | null = null;
  let inDataRows = false;
  const out = new Map<string, string>();

  for (const line of lines) {
    if (!line) continue;

    const headerMatch = CATEGORY_LEADERS_HEADER_RE.exec(line);
    if (headerMatch) {
      fileDivisionCode = divisionCodeFromLabel(headerMatch[1]);
      currentCategory = null;
      inDataRows = false;
      continue;
    }
    if (!fileDivisionCode) continue;

    const categoryMatch = CATEGORY_BLOCK_RE.exec(line);
    if (categoryMatch) {
      currentCategory = categoryMatch[1].trim();
      inDataRows = false;
      continue;
    }

    // El header de tabla "Final Name USPSA# Division Time % ..." marca el
    // inicio de las filas de datos de la categoría actual.
    if (FINAL_HEADER_RE.test(line)) {
      inDataRows = true;
      continue;
    }
    if (!inDataRows || !currentCategory) continue;

    const m = ENTRY_ROW_RE.exec(line);
    if (!m) continue;
    const [, , rawName] = m;
    const { fullName: stripped } = stripDqPrefix(rawName);
    const cleanedName = stripNameSuffixes(stripped);
    const key = `${fileDivisionCode}|${normalizeName(cleanedName)}`;
    out.set(key, currentCategory);
  }

  return out;
}

/**
 * Extrae nombre y fecha del torneo desde las primeras líneas del archivo.
 * Formato típico: línea 1 = "Steel Challenge" (o nombre custom si el
 * organizador puso uno), línea 2 = "YYYY-MM-DD", línea 3 = header del tipo
 * de reporte ("Stage Results - By Division" / "Category Leaders - ...").
 */
function extractNameAndDate(file: SteelPdfFile): {
  name: string;
  date: string;
} {
  const text = joinFileText(file);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  let date = "";
  let name = "";

  for (const line of lines) {
    // Salteamos los headers decorativos.
    if (/Stage\s+Results\s*-/i.test(line)) continue;
    if (/Category\s+Leaders\s*-/i.test(line)) continue;

    const dateMatch = TITLE_DATE_RE.exec(line);
    if (dateMatch && line.replace(dateMatch[1], "").trim() === "") {
      date = dateMatch[1];
      continue;
    }
    if (!name) {
      name = line;
    }
    if (name && date) break;
  }

  return { name: name || "Steel Challenge", date };
}

function joinFileText(file: SteelPdfFile): string {
  return file.pages.map((p) => p.text).join("\n");
}

/**
 * Normaliza nombre para usarlo como clave de identidad cuando agregamos
 * resultados de múltiples archivos. Quitamos espacios extra y normalizamos
 * mayúsculas — los acentos los preservamos porque la DB sí los conserva
 * y queremos que el shooter resuelva al mismo registro tanto si vino de un
 * stage como del overall.
 */
function normalizeName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}
