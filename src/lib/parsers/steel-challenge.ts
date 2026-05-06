import { parse, type HTMLElement } from "node-html-parser";
import { DISCIPLINE } from "../disciplines";
import type {
  ParsedMatch,
  ParsedMatchEntry,
  ParsedShooter,
  ParsedStage,
  ParsedStageResult,
} from "../types/match";

/**
 * Parser para reportes HTML de Steel Challenge generados por PractiScore.
 *
 * Diferencias con IPSC:
 *  - Un único archivo trae match overall + stages como columnas.
 *  - Scoring es time-based (menor tiempo = mejor). No hay hit factor.
 *  - Cada bloque de división tiene cabecera con el nombre de la división
 *    en mayúsculas dentro de un <td class="division_head">.
 *  - Las columnas de stages siguen el patrón "N: Nombre" (ej. "1: Cancha 3").
 *
 * Detección: ver `isSteelChallengeFormat`.
 */

interface SectionBlock {
  divisionCode: string;
  headers: string[];
  rows: string[][];
}

const TITLE_DATE_RE = /(\d{4}-\d{2}-\d{2})/;

export function isSteelChallengeFormat(html: string): boolean {
  // Heurística:
  //  - Steel: "Match Results - By Division" en el body, o título con "Steel Challenge",
  //    y headers con "Time" + "%" pero sin "Match Pts".
  //  - IPSC: "Match Results - <Division>" o "Stage Results - <Division>".
  if (/Match\s+Results\s*-\s*By\s+Division/i.test(html)) return true;
  if (/Steel\s+Challenge/i.test(html)) return true;
  return false;
}

export function parseSteelChallengeHtml(html: string): ParsedMatch {
  const root = parse(html);

  const { name, date } = extractNameAndDate(root, html);
  const generatedBy = extractGeneratedBy(root);
  const sections = extractSections(root);

  const matchEntries: ParsedMatchEntry[] = [];
  const stagesByName = new Map<string, ParsedStage>();

  for (const section of sections) {
    const stageColumns = detectStageColumns(section.headers);

    for (const row of section.rows) {
      const entry = parseEntryRow(section.headers, row, section.divisionCode);
      if (!entry) continue;
      matchEntries.push(entry);

      // Cada celda de stage produce un ParsedStageResult vinculado
      // al match_entry de este tirador.
      for (const sc of stageColumns) {
        const cellTime = parseFloatOrNull(row[sc.headerIndex]);
        if (cellTime === null) continue;

        const stageKey = `${sc.stageNumber}:${sc.label}`;
        if (!stagesByName.has(stageKey)) {
          stagesByName.set(stageKey, {
            stageNumber: sc.stageNumber,
            name: sc.label,
            results: [],
          });
        }
        const stage = stagesByName.get(stageKey)!;
        stage.results.push(buildStageResult(entry, cellTime));
      }
    }
  }

  // Calcular ranking + porcentaje por stage (menor tiempo = 100%)
  const stages: ParsedStage[] = Array.from(stagesByName.values())
    .sort((a, b) => (a.stageNumber ?? 0) - (b.stageNumber ?? 0))
    .map((s) => withStagePlacings(s));

  const region =
    matchEntries.find((e) => e.shooter.region)?.shooter.region ?? null;

  return {
    discipline: DISCIPLINE.STEEL,
    source: "practiscore_steel_html",
    name,
    date,
    region,
    matchEntries,
    stages,
    generatedBy,
  };
}

// ---------------------------------------------------------------------------
// Sección por división
// ---------------------------------------------------------------------------

function extractSections(root: HTMLElement): SectionBlock[] {
  const out: SectionBlock[] = [];
  const rows = root.querySelectorAll("tr");
  let current: SectionBlock | null = null;

  for (const tr of rows) {
    const head = tr.querySelector("td.division_head");
    if (head) {
      const divisionCode = head.querySelector("b")?.textContent?.trim() ?? "";
      if (current) out.push(current);
      current = { divisionCode, headers: [], rows: [] };
      continue;
    }
    if (!current) continue;

    const ths = tr.querySelectorAll("th");
    if (ths.length > 0) {
      current.headers = ths.map((t) => t.textContent.trim());
      continue;
    }

    const tds = tr.querySelectorAll("td");
    if (tds.length > 0) {
      current.rows.push(tds.map((d) => d.textContent.trim()));
    }
  }

  if (current) out.push(current);
  return out;
}

// ---------------------------------------------------------------------------
// Stages: detectar columnas tipo "N: Nombre"
// ---------------------------------------------------------------------------

interface StageColumn {
  headerIndex: number;
  stageNumber: number;
  label: string; // ej "Cancha 3"
}

const STAGE_HEADER_RE = /^\s*(\d+)\s*:\s*(.+?)\s*$/;

function detectStageColumns(headers: string[]): StageColumn[] {
  const result: StageColumn[] = [];
  for (let i = 0; i < headers.length; i++) {
    const m = STAGE_HEADER_RE.exec(headers[i]);
    if (m) {
      result.push({
        headerIndex: i,
        stageNumber: parseInt(m[1], 10),
        label: m[2].trim(),
      });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Entry parsing
// ---------------------------------------------------------------------------

function parseEntryRow(
  headers: string[],
  row: string[],
  divisionCode: string,
): ParsedMatchEntry | null {
  const get = (key: string) => columnValue(headers, row, key);
  const placeRaw = get("Final");
  const nameRaw = get("Name");
  if (!placeRaw || !nameRaw) return null;

  const { fullName, isDq } = stripDqPrefix(nameRaw);
  const totalTime = parseFloatOrNull(get("Time"));

  return {
    shooter: {
      fullName,
      memberNumber: nullIfEmpty(get("USPSA#")) ?? nullIfEmpty(get("No.")),
      region: null, // Steel report no incluye región por fila
    },
    divisionCode,
    classification: nullIfEmpty(get("Class")),
    powerFactor: null, // Steel no tiene power factor
    category: nullIfEmpty(get("Category")),
    place: parseIntOr(placeRaw, 0),
    matchPoints: 0,
    matchPercentage: parsePercentage(get("%")),
    totalTimeSeconds: totalTime,
    isDq,
  };
}

function buildStageResult(
  entry: ParsedMatchEntry,
  timeSeconds: number,
): ParsedStageResult {
  return {
    shooter: entry.shooter,
    divisionCode: entry.divisionCode,
    classification: entry.classification,
    powerFactor: entry.powerFactor,
    points: null,
    penalties: null,
    timeSeconds,
    hitFactor: null,
    stagePoints: 0,
    stagePercentage: 0, // se completa en withStagePlacings
    place: 0,
    isDq: entry.isDq,
  };
}

/** Calcula place + stage_percentage por stage, dentro de cada división. */
function withStagePlacings(stage: ParsedStage): ParsedStage {
  const byDivision = new Map<string, ParsedStageResult[]>();
  for (const r of stage.results) {
    const key = r.divisionCode;
    if (!byDivision.has(key)) byDivision.set(key, []);
    byDivision.get(key)!.push(r);
  }

  for (const list of byDivision.values()) {
    // Tiempos válidos primero por menor tiempo; DQ al final.
    const valid = list.filter(
      (r) => !r.isDq && r.timeSeconds !== null && r.timeSeconds > 0,
    );
    valid.sort((a, b) => (a.timeSeconds ?? 0) - (b.timeSeconds ?? 0));
    const winnerTime = valid[0]?.timeSeconds ?? null;

    let place = 1;
    for (const r of valid) {
      r.place = place++;
      r.stagePercentage =
        winnerTime && r.timeSeconds && r.timeSeconds > 0
          ? (winnerTime / r.timeSeconds) * 100
          : 0;
    }
  }

  return stage;
}

// ---------------------------------------------------------------------------
// Helpers compartidos (versión local; igual que en el parser IPSC)
// ---------------------------------------------------------------------------

function columnValue(
  headers: string[],
  row: string[],
  key: string,
): string | undefined {
  const i = headers.findIndex((h) => h === key);
  if (i < 0) return undefined;
  return row[i]?.trim();
}

function stripDqPrefix(name: string): { fullName: string; isDq: boolean } {
  const m = /^\(DQ\)\s*(.+)$/.exec(name);
  if (m) return { fullName: m[1].trim(), isDq: true };
  return { fullName: name.trim(), isDq: false };
}

function parsePercentage(value: string | undefined): number {
  if (!value) return 0;
  const n = Number(value.replace("%", "").trim());
  return Number.isFinite(n) ? n : 0;
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
  const t = value.trim();
  return t === "" ? null : t;
}

function extractNameAndDate(
  root: HTMLElement,
  html: string,
): { name: string; date: string } {
  // El primer div con texto suele tener "Nombre del torneo<br>YYYY-MM-DD<br>Match Results - By Division"
  const firstDiv = root.querySelector("body > div");
  let raw = firstDiv?.innerHTML ?? "";

  // Si el div no fue encontrado, intentamos con título
  if (!raw) {
    raw = root.querySelector("title")?.textContent ?? "";
  }

  // Normalizamos los <br> a saltos de línea simples
  const normalized = raw.replace(/<br\s*\/?>/gi, "\n");

  // El título es la primera línea no vacía
  const lines = normalized
    .split("\n")
    .map((l) => l.replace(/<[^>]+>/g, "").trim())
    .filter(Boolean);

  let name = "";
  let date = "";

  for (const line of lines) {
    if (TITLE_DATE_RE.test(line)) {
      const m = TITLE_DATE_RE.exec(line)!;
      date = m[1];
      // El nombre puede estar en otra línea o en la misma con prefijo
      if (!name && line.replace(m[1], "").trim().length > 0) {
        // raro, pero por las dudas
        name = line.replace(m[1], "").replace(/[-\s:]+$/, "").trim();
      }
      continue;
    }
    if (/Match\s+Results\s*-/i.test(line)) continue; // header decorativo
    if (!name) name = line;
  }

  // Fallback: si no detectamos fecha en el div, buscar en cualquier parte del HTML
  if (!date) {
    const m = TITLE_DATE_RE.exec(html);
    if (m) date = m[1];
  }

  return { name: name.trim(), date };
}

function extractGeneratedBy(root: HTMLElement): string | null {
  const div = root.querySelectorAll("div").find((d) => /Generated by/i.test(d.textContent));
  return div ? div.textContent.replace(/\s+/g, " ").trim() : null;
}
