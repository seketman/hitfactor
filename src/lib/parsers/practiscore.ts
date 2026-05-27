import { parse } from "node-html-parser";
import { DISCIPLINE } from "../disciplines";
import type {
  ParsedMatch,
  ParsedMatchEntry,
  ParsedMatchSource,
  ParsedStage,
  ParsedStageResult,
  PowerFactor,
} from "../types/match";
import {
  columnValue,
  extractClubFromTitle,
  extractDivisionalTableSections,
  extractGeneratedBy,
  nullIfEmpty,
  parseFloatOr,
  parseFloatOrNull,
  parseIntOr,
  parsePercentage,
  stripDqPrefix,
  stripNameSuffixes,
} from "./shared";

/**
 * Parser para reportes HTML generados por PractiScore (Tiro Práctico / IPSC).
 *
 * Soporta tres formatos de archivo:
 *  1. Match Results combinado (`Match Results - Combined`)
 *  2. Match Results por división (varias secciones `Match Results - X`)
 *  3. Stage Results (varias secciones `Stage Results - X` dentro de un único stage)
 *
 * El parser es agnóstico de DB y devuelve `ParsedMatch`. La resolución de
 * tiradores contra `shooters` y la deduplicación de matches se hace después.
 */

interface SectionMeta {
  kind: "match" | "stage";
  /** Texto del header tras "Match Results - " o "Stage Results - " */
  title: string;
  /**
   * Código de división derivado del título de la sección (ej. "Pistola" →
   * "PIS"). Null para secciones "Combined" o para títulos que no matchean
   * el mapa — en esos casos cada fila usa su columna `Div` como antes.
   */
  divisionCode: string | null;
}

const TITLE_DATE_RE = /-\s*(\d{4}-\d{2}-\d{2})\s*$/;
// Acepta las mismas variantes que stripStageSuffix (en/es): "Stage 1",
// "Ejercicio 2", "Etapa 3", "Stand 4", "Ej. 5", "St. 6", "Match 1". Si
// el título usa una variante en español y este regex solo reconocía
// "Stage", el número quedaba null y el stage se filtraba silenciosamente
// en attachStagesToMatch (el banner "se agregaron stages" igual aparecía
// porque resolveMatchForStage había encontrado el match — pero ningún
// stage_result terminaba en la DB).
const STAGE_NUMBER_RE =
  /(?:Stage|Ejercicio|Ej\.?|Stand|St\.?|Etapa|Match)\s+(\d+)/i;

/**
 * Mapa de título de sección IPSC (tal como aparece tras "Match Results - "
 * o "Stage Results - ", normalizado a MAYÚSCULAS sin espacios sobrantes)
 * al `code` de la tabla `divisions`.
 *
 * Usamos esto en lugar de la columna `Div` de cada fila porque PractiScore
 * le deja al organizador definir los códigos cortos en la config del match
 * — y no son estables entre matches. Vimos archivos con `C` para Classic,
 * `P` para Pcc y `P` para Pistola en el mismo torneo; el título de la
 * sección sí es texto humano fijo y mapea bien a las divisiones de la DB.
 */
const DIVISION_CODE_BY_TITLE: Record<string, string> = {
  OPEN: "O",
  PRODUCTION: "P",
  "PRODUCTION OPTICS": "PO",
  STANDARD: "S",
  "STANDARD MANUAL": "SM",
  "CARRY OPTICS": "CO",
  REVOLVER: "R",
  CLASSIC: "CL",
  MODIFIED: "MS",
  "MODIFIED SHOTGUN": "MS",
  PCC: "PCC",
  "PCC OPTIC": "PCCO",
  "PCC OPTICS": "PCCO",
  PISTOLA: "PIS",
};

function divisionCodeFromTitle(title: string): string | null {
  const norm = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
  return DIVISION_CODE_BY_TITLE[norm] ?? null;
}

export function parsePractiscoreHtml(html: string): ParsedMatch {
  const root = parse(html);

  const heading = root.querySelector("h3")?.textContent?.trim() ?? "";
  const title = root.querySelector("title")?.textContent?.trim() ?? "";

  const { name, date } = extractNameAndDate(heading || title);
  const generatedBy = extractGeneratedBy(root);
  const sections = extractDivisionalTableSections<SectionMeta>(root, classifyHead);

  // Determinar tipo de archivo a partir de las secciones encontradas.
  const hasStageSections = sections.some((s) => s.meta.kind === "stage");
  const hasMatchSections = sections.some((s) => s.meta.kind === "match");

  let source: ParsedMatchSource;
  if (hasStageSections) {
    source = "practiscore_stage_html";
  } else if (
    hasMatchSections &&
    sections.length === 1 &&
    /combined/i.test(sections[0].meta.title)
  ) {
    source = "practiscore_combined_html";
  } else {
    source = "practiscore_match_html";
  }

  const matchEntries: ParsedMatchEntry[] = [];
  const stages: ParsedStage[] = [];

  if (hasStageSections) {
    // Todos los Stage Results de este archivo pertenecen al mismo stage,
    // pero están particionados por división en secciones distintas.
    const stageNumber = extractStageNumber(heading || title);
    const stageName = heading || title;
    const allResults: ParsedStageResult[] = [];
    for (const section of sections) {
      if (section.meta.kind !== "stage") continue;
      for (const row of section.rows) {
        const result = parseStageRow(
          section.headers,
          row,
          section.meta.divisionCode,
        );
        if (result) allResults.push(result);
      }
    }
    stages.push({
      stageNumber,
      name: stageName,
      results: allResults,
    });
  } else {
    for (const section of sections) {
      if (section.meta.kind !== "match") continue;
      for (const row of section.rows) {
        const entry = parseMatchRow(
          section.headers,
          row,
          section.meta.divisionCode,
        );
        if (entry) matchEntries.push(entry);
      }
    }
  }

  // Región del match: priorizamos la primera no nula extraída de la
  // columna Region de los tiradores. Si no hay (caso típico: archivos
  // Stage Results donde la columna Region no aparece), intentamos
  // extraer el club desde el título — patrones tipo "TFALP" al final
  // de "TP ESCOPETA 20/02/26 TFALP".
  const region =
    matchEntries.find((e) => e.shooter.region)?.shooter.region ??
    stages
      .flatMap((s) => s.results)
      .find((r) => r.shooter.region)?.shooter.region ??
    extractClubFromTitle(name);

  return {
    discipline: DISCIPLINE.IPSC,
    source,
    name,
    date,
    region,
    matchEntries,
    stages,
    generatedBy,
  };
}

function classifyHead(titleText: string): SectionMeta | null {
  const stageMatch = /^Stage\s+Results\s*-\s*(.+)$/i.exec(titleText);
  if (stageMatch) {
    const title = stageMatch[1].trim();
    return { kind: "stage", title, divisionCode: divisionCodeFromTitle(title) };
  }
  const matchMatch = /^Match\s+Results\s*-\s*(.+)$/i.exec(titleText);
  if (matchMatch) {
    const title = matchMatch[1].trim();
    return { kind: "match", title, divisionCode: divisionCodeFromTitle(title) };
  }
  return null;
}

function parseMatchRow(
  headers: string[],
  row: string[],
  sectionDivisionCode: string | null,
): ParsedMatchEntry | null {
  // Headers esperados: Place, Name, No., Class, Div, PF, Category, Match Pts, Match %, Region
  const get = (key: string) => columnValue(headers, row, key);
  const placeRaw = get("Place");
  const nameRaw = get("Name");
  if (!placeRaw || !nameRaw) return null;

  const { fullName: rawName, isDq } = stripDqPrefix(nameRaw);
  const fullName = stripNameSuffixes(rawName);
  const matchPoints = parseFloatOr(get("Match Pts"), 0);
  const matchPercentage = parsePercentage(get("Match %"));

  return {
    shooter: {
      fullName,
      memberNumber: nullIfEmpty(get("No.")),
      region: nullIfEmpty(get("Region")),
    },
    // Preferimos el code derivado del título de la sección (estable) sobre
    // la columna `Div` de la fila (configurable por el organizador en
    // PractiScore). Para secciones "Combined" sectionDivisionCode es null
    // y caemos a la columna `Div`, que es la única fuente disponible ahí.
    divisionCode: sectionDivisionCode ?? get("Div") ?? "",
    classification: nullIfEmpty(get("Class")),
    powerFactor: parsePowerFactor(get("PF")),
    category: nullIfEmpty(get("Category")),
    place: parseIntOr(placeRaw, 0),
    matchPoints,
    matchPercentage,
    totalTimeSeconds: null, // IPSC no usa tiempo total; queda explícito.
    hits: null, // IPSC no usa impactos — el scoring es hit factor.
    isDq,
    // Tirador anotado pero ausente: queda con 0 puntos y 0%. Solo cuando
    // NO es DQ (que es una señal más fuerte y específica).
    isAbsent: !isDq && matchPoints === 0 && matchPercentage === 0,
  };
}

function parseStageRow(
  headers: string[],
  row: string[],
  sectionDivisionCode: string | null,
): ParsedStageResult | null {
  // Headers esperados: Place, Name, No., Class, Div, PF, Points, Pen, Time, Hit Factor, Stage Pts, Stage %
  const get = (key: string) => columnValue(headers, row, key);
  const nameRaw = get("Name");
  if (!nameRaw) return null;

  const { fullName: rawName, isDq } = stripDqPrefix(nameRaw);
  const fullName = stripNameSuffixes(rawName);

  // En filas DQ casi todos los campos vienen vacíos; tomamos lo que haya.
  return {
    shooter: {
      fullName,
      memberNumber: nullIfEmpty(get("No.")),
      region: null, // Stage results de PractiScore no incluyen Region
    },
    // Mismo razonamiento que en `parseMatchRow`: section header > row Div.
    divisionCode: sectionDivisionCode ?? get("Div") ?? "",
    classification: nullIfEmpty(get("Class")),
    powerFactor: parsePowerFactor(get("PF")),
    points: parseFloatOrNull(get("Points")),
    penalties: parseFloatOrNull(get("Pen")),
    timeSeconds: parseFloatOrNull(get("Time")),
    hitFactor: parseFloatOrNull(get("Hit Factor")),
    stagePoints: parseFloatOr(get("Stage Pts"), 0),
    stagePercentage: parsePercentage(get("Stage %")),
    place: parseIntOr(get("Place") ?? "", 0),
    hits: null,
    isDq,
  };
}

function parsePowerFactor(value: string | undefined): PowerFactor {
  if (!value) return null;
  const v = value.trim();
  if (v === "Min" || v === "Maj") return v;
  return null;
}

function extractNameAndDate(heading: string): { name: string; date: string } {
  // Ej: "1er Ranking Social 2026 - 2026-03-28"
  // Ej: "TP ESCOPETA 20/02/26 TFALP  - Stage 1 - 2026-02-20"
  const dateMatch = TITLE_DATE_RE.exec(heading);
  const date = dateMatch ? dateMatch[1] : "";
  const name = dateMatch
    ? heading.slice(0, dateMatch.index).replace(/[-\s]+$/, "").trim()
    : heading.trim();
  return { name, date };
}

function extractStageNumber(heading: string): number | null {
  const m = STAGE_NUMBER_RE.exec(heading);
  return m ? parseInt(m[1], 10) : null;
}
