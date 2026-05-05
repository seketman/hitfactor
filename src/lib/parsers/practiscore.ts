import { parse, type HTMLElement } from "node-html-parser";
import type {
  ParsedMatch,
  ParsedMatchEntry,
  ParsedMatchSource,
  ParsedShooter,
  ParsedStage,
  ParsedStageResult,
  PowerFactor,
} from "../types/match";

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

interface SectionBlock {
  kind: "match" | "stage";
  /** Texto del header tras "Match Results - " o "Stage Results - " */
  title: string;
  /** Filas de header (th) */
  headers: string[];
  /** Filas de datos (tr con tds) */
  rows: string[][];
}

const TITLE_DATE_RE = /-\s*(\d{4}-\d{2}-\d{2})\s*$/;
const STAGE_NUMBER_RE = /Stage\s+(\d+)/i;

export function parsePractiscoreHtml(html: string): ParsedMatch {
  const root = parse(html);

  const heading = root.querySelector("h3")?.textContent?.trim() ?? "";
  const title = root.querySelector("title")?.textContent?.trim() ?? "";

  const { name, date } = extractNameAndDate(heading || title);
  const generatedBy = extractGeneratedBy(root);
  const sections = extractSections(root);

  // Determinar tipo de archivo a partir de las secciones encontradas.
  const hasStageSections = sections.some((s) => s.kind === "stage");
  const hasMatchSections = sections.some((s) => s.kind === "match");

  let source: ParsedMatchSource;
  if (hasStageSections) {
    source = "practiscore_stage_html";
  } else if (
    hasMatchSections &&
    sections.length === 1 &&
    /combined/i.test(sections[0].title)
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
      if (section.kind !== "stage") continue;
      for (const row of section.rows) {
        const result = parseStageRow(section.headers, row);
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
      if (section.kind !== "match") continue;
      for (const row of section.rows) {
        const entry = parseMatchRow(section.headers, row);
        if (entry) matchEntries.push(entry);
      }
    }
  }

  // Región del match: tomamos la primera no nula encontrada.
  const region =
    matchEntries.find((e) => e.shooter.region)?.shooter.region ??
    stages
      .flatMap((s) => s.results)
      .find((r) => r.shooter.region)?.shooter.region ??
    null;

  return {
    discipline: "ipsc",
    source,
    name,
    date,
    region,
    matchEntries,
    stages,
    generatedBy,
  };
}

function extractSections(root: HTMLElement): SectionBlock[] {
  const sections: SectionBlock[] = [];

  // Cada sección empieza con un <td class="division_head"> que contiene
  // un <b> con el título "Match Results - X" o "Stage Results - X".
  // Las filas de la sección son los <tr> hermanos siguientes hasta
  // el próximo division_head.
  const allRows = root.querySelectorAll("tr");
  let current: SectionBlock | null = null;

  for (const tr of allRows) {
    const headerCell = tr.querySelector("td.division_head");
    if (headerCell) {
      const titleText = headerCell.querySelector("b")?.textContent?.trim() ?? "";
      const stageMatch = /^Stage\s+Results\s*-\s*(.+)$/i.exec(titleText);
      const matchMatch = /^Match\s+Results\s*-\s*(.+)$/i.exec(titleText);
      if (stageMatch) {
        if (current) sections.push(current);
        current = { kind: "stage", title: stageMatch[1].trim(), headers: [], rows: [] };
      } else if (matchMatch) {
        if (current) sections.push(current);
        current = { kind: "match", title: matchMatch[1].trim(), headers: [], rows: [] };
      } else {
        // Header genérico que no reconocemos: ignorar.
      }
      continue;
    }

    if (!current) continue;

    // Header row (con th)
    const ths = tr.querySelectorAll("th");
    if (ths.length > 0) {
      current.headers = ths.map((th) => th.textContent.trim());
      continue;
    }

    // Data row (con td)
    const tds = tr.querySelectorAll("td");
    if (tds.length > 0) {
      current.rows.push(tds.map((td) => td.textContent.trim()));
    }
  }

  if (current) sections.push(current);
  return sections;
}

function parseMatchRow(headers: string[], row: string[]): ParsedMatchEntry | null {
  // Headers esperados: Place, Name, No., Class, Div, PF, Category, Match Pts, Match %, Region
  const get = (key: string) => columnValue(headers, row, key);
  const placeRaw = get("Place");
  const nameRaw = get("Name");
  if (!placeRaw || !nameRaw) return null;

  const { fullName, isDq } = stripDqPrefix(nameRaw);

  return {
    shooter: {
      fullName,
      memberNumber: nullIfEmpty(get("No.")),
      region: nullIfEmpty(get("Region")),
    },
    divisionCode: get("Div") ?? "",
    classification: nullIfEmpty(get("Class")),
    powerFactor: parsePowerFactor(get("PF")),
    category: nullIfEmpty(get("Category")),
    place: parseIntOr(placeRaw, 0),
    matchPoints: parseFloatOr(get("Match Pts"), 0),
    matchPercentage: parsePercentage(get("Match %")),
    isDq,
  };
}

function parseStageRow(headers: string[], row: string[]): ParsedStageResult | null {
  // Headers esperados: Place, Name, No., Class, Div, PF, Points, Pen, Time, Hit Factor, Stage Pts, Stage %
  const get = (key: string) => columnValue(headers, row, key);
  const nameRaw = get("Name");
  if (!nameRaw) return null;

  const { fullName, isDq } = stripDqPrefix(nameRaw);

  // En filas DQ casi todos los campos vienen vacíos; tomamos lo que haya.
  return {
    shooter: {
      fullName,
      memberNumber: nullIfEmpty(get("No.")),
      region: null, // Stage results de PractiScore no incluyen Region
    },
    divisionCode: get("Div") ?? "",
    classification: nullIfEmpty(get("Class")),
    powerFactor: parsePowerFactor(get("PF")),
    points: parseFloatOrNull(get("Points")),
    penalties: parseFloatOrNull(get("Pen")),
    timeSeconds: parseFloatOrNull(get("Time")),
    hitFactor: parseFloatOrNull(get("Hit Factor")),
    stagePoints: parseFloatOr(get("Stage Pts"), 0),
    stagePercentage: parsePercentage(get("Stage %")),
    place: parseIntOr(get("Place") ?? "", 0),
    isDq,
  };
}

function columnValue(headers: string[], row: string[], key: string): string | undefined {
  const i = headers.findIndex((h) => h === key);
  if (i < 0) return undefined;
  return row[i]?.trim();
}

function stripDqPrefix(name: string): { fullName: string; isDq: boolean } {
  const m = /^\(DQ\)\s*(.+)$/.exec(name);
  if (m) return { fullName: m[1].trim(), isDq: true };
  return { fullName: name.trim(), isDq: false };
}

function parsePowerFactor(value: string | undefined): PowerFactor {
  if (!value) return null;
  const v = value.trim();
  if (v === "Min" || v === "Maj") return v;
  return null;
}

function parsePercentage(value: string | undefined): number {
  if (!value) return 0;
  const cleaned = value.replace("%", "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseFloatOr(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseFloatOrNull(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseIntOr(value: string, fallback: number): number {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function nullIfEmpty(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
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

function extractGeneratedBy(root: HTMLElement): string | null {
  const div = root.querySelectorAll("div").find((d) => /Generated by/i.test(d.textContent));
  return div ? div.textContent.replace(/\s+/g, " ").trim() : null;
}
