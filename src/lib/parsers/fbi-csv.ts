import { DISCIPLINE } from "@/lib/disciplines";
import type {
  ParsedMatch,
  ParsedMatchEntry,
  ParsedShooter,
  ParsedStage,
  ParsedStageResult,
} from "@/lib/types/match";
import {
  extractClubFromTitle,
  nullIfEmpty,
  parseIntOrNull,
  pickMostCommon,
} from "./shared";

/**
 * Parser para resultados de Tiro FBI exportados desde Google Sheets como CSV.
 *
 * Formato esperado (basado en planillas TFALP):
 *  - Fila con título: "Social N - DD/MM/YY" (o similar con fecha al final)
 *  - Fila de headers principal: contiene `Tirador, Club, Categoría, Disciplina,
 *    Práctica, Tirada 1..8, Impactos, Puntos`. Cada stage ocupa 5 columnas (los
 *    5 disparos), con sub-headers `1, 2, 3, 4, 5` en la fila siguiente.
 *  - Filas de datos: una por (tirador, disciplina). Se descartan filas sin Tirador.
 *
 * Reglas FBI:
 *  - Cada match son **9 stages**: 1 de Práctica (no suma) + 8 que sí suman.
 *  - Cada stage son 5 disparos puntuados 0–10 (0 = falla).
 *  - Si el tirador es DQ en un stage, la planilla puede traer un marcador
 *    tipo `F4D` en lugar del primer disparo y el resto vacío. Ese stage queda
 *    con 0 puntos y `isDq=true`.
 *  - `Puntos` total = suma de los 8 stages que cuentan (sin Práctica).
 *  - `Impactos` = cantidad de disparos no-cero en los 8 que cuentan (max 40).
 *
 * Cada `Disciplina` del CSV (Pistola/Revólver/Minirifle/PCC) se mapea a una
 * división de la disciplina FBI. El ranking del match se calcula **por
 * división** ordenando por Puntos descendente (tiebreak por Impactos), tal
 * como en IPSC. `match_percentage` y `stage_percentage` son relativos al
 * ganador de cada división.
 */

const HEADER_TIRADOR = "tirador";
const HEADER_CLUB = "club";
const HEADER_CATEGORIA = "categoría";
const HEADER_DISCIPLINA = "disciplina";
const HEADER_IMPACTOS = "impactos";
const HEADER_PUNTOS = "puntos";

const REQUIRED_HEADERS = [
  HEADER_TIRADOR,
  HEADER_CLUB,
  HEADER_CATEGORIA,
  HEADER_DISCIPLINA,
  HEADER_IMPACTOS,
  HEADER_PUNTOS,
];

/**
 * Mapa de la columna "Disciplina" del CSV al `code` de la tabla `divisions`
 * (ver migración 0004_fbi.sql).
 */
const DIVISION_CODE: Record<string, string> = {
  pistola: "PIS",
  revolver: "REV",
  revólver: "REV",
  minirifle: "MINI",
  pcc: "PCC",
};

/**
 * Stages esperados en el orden y nombre canónico que se persiste en DB.
 * `Práctica` es stage 0 — informativo, no suma al match.
 *
 * `aliases` cubre variantes de cómo aparece el header en distintas planillas:
 * con/sin acento, con espacios, etc. Después de normalizar comparamos contra
 * cualquiera.
 */
const STAGE_LABELS: Array<{
  number: number;
  name: string;
  aliases: string[];
}> = [
  { number: 0, name: "Práctica", aliases: ["práctica", "practica"] },
  { number: 1, name: "Tirada 1", aliases: ["tirada 1"] },
  { number: 2, name: "Tirada 2", aliases: ["tirada 2"] },
  { number: 3, name: "Tirada 3", aliases: ["tirada 3"] },
  { number: 4, name: "Tirada 4", aliases: ["tirada 4"] },
  { number: 5, name: "Tirada 5", aliases: ["tirada 5"] },
  { number: 6, name: "Tirada 6", aliases: ["tirada 6"] },
  { number: 7, name: "Tirada 7", aliases: ["tirada 7"] },
  { number: 8, name: "Tirada 8", aliases: ["tirada 8"] },
];

/** Cantidad de disparos por stage en FBI. */
const SHOTS_PER_STAGE = 5;

interface StageColumn {
  number: number;
  name: string;
  /** Índice de la primera de las 5 columnas de disparos. */
  startIdx: number;
}

export function isFbiCsvFormat(content: string): boolean {
  // Probamos las primeras ~10 líneas: si encontramos una con todos los headers
  // requeridos, es FBI CSV.
  const head = content.split(/\r?\n/).slice(0, 10);
  for (const line of head) {
    const cells = parseCsvRow(line).map((c) => normalize(c));
    if (REQUIRED_HEADERS.every((h) => cells.includes(h))) return true;
  }
  return false;
}

export function parseFbiCsv(content: string): ParsedMatch {
  const lines = content.split(/\r?\n/);
  const rows = lines.map(parseCsvRow);

  const headerIdx = rows.findIndex((cells) => {
    const normalized = cells.map(normalize);
    return REQUIRED_HEADERS.every((h) => normalized.includes(h));
  });
  if (headerIdx === -1) {
    throw new Error("No se encontró la fila de headers (Tirador, Club, ...).");
  }

  const headers = rows[headerIdx]!.map(normalize);
  const col = (name: string) => {
    const i = headers.indexOf(name);
    if (i === -1) throw new Error(`Header faltante: ${name}`);
    return i;
  };
  const idxTirador = col(HEADER_TIRADOR);
  const idxClub = col(HEADER_CLUB);
  const idxCategoria = col(HEADER_CATEGORIA);
  const idxDisciplina = col(HEADER_DISCIPLINA);
  const idxImpactos = col(HEADER_IMPACTOS);
  const idxPuntos = col(HEADER_PUNTOS);

  // Detectar las columnas de stages: cada label canónico ocupa una celda en
  // la fila de headers (con la siguiente fila trayendo los sub-headers 1..5).
  // Aceptamos que falten algunos stages — la planilla podría no completar
  // todos si el match no se corrió entero.
  const stageCols = detectStageColumns(headers);

  // Título y fecha: lo buscamos en las filas anteriores al header.
  const { matchName, date } = extractTitle(rows.slice(0, headerIdx));

  // Filas de datos: desde después del header, descartando vacías o sub-headers.
  const dataRows = rows.slice(headerIdx + 1).filter((cells) => {
    const tirador = (cells[idxTirador] ?? "").trim();
    if (!tirador) return false;
    // Guardas contra una eventual sub-header repetida.
    if (normalize(tirador) === HEADER_TIRADOR) return false;
    return true;
  });

  // Agrupamos por división para computar place + match_percentage.
  const byDivision = new Map<string, RawEntry[]>();
  for (const cells of dataRows) {
    const disciplinaRaw = (cells[idxDisciplina] ?? "").trim();
    const divisionCode = DIVISION_CODE[normalize(disciplinaRaw)];
    if (!divisionCode) {
      // División desconocida: la saltamos en lugar de romper el import.
      continue;
    }
    const puntos = parseIntOrNull(cells[idxPuntos]);
    const impactos = parseIntOrNull(cells[idxImpactos]);
    if (puntos === null) continue;

    const fullName = (cells[idxTirador] ?? "").trim();
    if (!fullName) continue;

    // Capturamos los puntos por stage para esta fila — los acompañamos al
    // RawEntry para que sobrevivan la dedup (mantenemos los stages del row
    // ganador, no de cualquier duplicado).
    const stages = new Map<number, RawStage>();
    for (const sc of stageCols) {
      const shots = cells.slice(sc.startIdx, sc.startIdx + SHOTS_PER_STAGE);
      let stagePoints = 0;
      let stageHits = 0;
      for (const v of shots) {
        const p = parseShot(v);
        stagePoints += p;
        if (p > 0) stageHits++;
      }
      const isDq = hasNonNumericMarker(shots);
      stages.set(sc.number, { stagePoints, hits: stageHits, isDq });
    }

    const entry: RawEntry = {
      shooter: {
        fullName,
        memberNumber: null,
        region: nullIfEmpty(cells[idxClub]),
      },
      divisionCode,
      category: nullIfEmpty(cells[idxCategoria]),
      puntos,
      impactos: impactos ?? 0,
      stages,
    };

    const list = byDivision.get(divisionCode);
    if (list) list.push(entry);
    else byDivision.set(divisionCode, [entry]);
  }

  // Si un mismo tirador aparece varias veces en la misma división (raro,
  // pero posible si la planilla registra varias tiradas de control) nos
  // quedamos con el mejor puntaje. El UNIQUE de la DB lo rechazaría, así
  // que dedupeamos acá para no romper el import.
  for (const [code, group] of byDivision) {
    const best = new Map<string, RawEntry>();
    for (const e of group) {
      const key = e.shooter.fullName.toLowerCase();
      const prev = best.get(key);
      if (!prev || e.puntos > prev.puntos) best.set(key, e);
    }
    byDivision.set(code, Array.from(best.values()));
  }

  // Construimos matchEntries (con place + percentage por división).
  const matchEntries: ParsedMatchEntry[] = [];
  for (const [, group] of byDivision) {
    group.sort((a, b) => {
      if (b.puntos !== a.puntos) return b.puntos - a.puntos;
      return b.impactos - a.impactos;
    });
    const winnerPuntos = group[0]?.puntos ?? 0;
    group.forEach((e, i) => {
      matchEntries.push({
        shooter: e.shooter,
        divisionCode: e.divisionCode,
        classification: null,
        powerFactor: null,
        category: e.category,
        place: i + 1,
        matchPoints: e.puntos,
        matchPercentage:
          winnerPuntos > 0 ? (e.puntos / winnerPuntos) * 100 : 0,
        totalTimeSeconds: null,
        hits: e.impactos,
        isDq: false,
      });
    });
  }

  // Construimos los stages con sus results por shooter, calculando place y
  // percentage **por división** dentro de cada stage (igual que IPSC/Steel).
  const stages = buildStages(stageCols, byDivision);

  // El club del match: priorizamos el Club más frecuente entre los
  // tiradores (la columna Club del CSV de FBI suele ser uniforme dentro
  // de un mismo torneo). Como fallback, intentamos extraerlo del título
  // — aunque los títulos FBI (ej. "Social 4") raramente lo tienen.
  const region =
    pickMostCommon(matchEntries.map((e) => e.shooter.region)) ??
    extractClubFromTitle(matchName);

  return {
    discipline: DISCIPLINE.FBI,
    source: "fbi_csv",
    name: matchName,
    date,
    region,
    matchEntries,
    stages,
    generatedBy: null,
  };
}

interface RawStage {
  stagePoints: number;
  hits: number;
  isDq: boolean;
}

interface RawEntry {
  shooter: ParsedShooter;
  divisionCode: string;
  category: string | null;
  puntos: number;
  impactos: number;
  /** Puntos por stage capturados de esta fila — sobreviven la dedup. */
  stages: Map<number, RawStage>;
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

function detectStageColumns(headers: string[]): StageColumn[] {
  const out: StageColumn[] = [];
  for (const { number, name, aliases } of STAGE_LABELS) {
    for (const alias of aliases) {
      const idx = headers.indexOf(alias);
      if (idx >= 0) {
        out.push({ number, name, startIdx: idx });
        break;
      }
    }
  }
  return out;
}

/**
 * Parsea una celda de disparo. Acepta enteros 0–10. Cualquier otra cosa
 * (vacío, "F4D", letras) cuenta como 0. Math.trunc para manejar planillas
 * que a veces traen "10.0".
 */
function parseShot(value: string | undefined): number {
  if (!value) return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > 10) return 0;
  return Math.trunc(n);
}

/**
 * `true` si alguna celda del stage tiene texto no-numérico no vacío (ej.
 * "F4D" = falta de seguridad / DQ en ese stage).
 */
function hasNonNumericMarker(cells: string[]): boolean {
  for (const c of cells) {
    const t = (c ?? "").trim();
    if (!t) continue;
    if (!Number.isFinite(Number(t))) return true;
  }
  return false;
}

function buildStages(
  stageCols: StageColumn[],
  byDivision: Map<string, RawEntry[]>,
): ParsedStage[] {
  if (stageCols.length === 0) return [];

  // Iniciamos un bucket por stage detectado.
  const stageMap = new Map<number, ParsedStage>();
  for (const sc of stageCols) {
    stageMap.set(sc.number, {
      stageNumber: sc.number,
      name: sc.name,
      results: [],
    });
  }

  // Vertimos los results de cada (entry, stage) a su bucket.
  for (const [, group] of byDivision) {
    for (const entry of group) {
      for (const sc of stageCols) {
        const raw = entry.stages.get(sc.number) ?? {
          stagePoints: 0,
          hits: 0,
          isDq: false,
        };
        stageMap.get(sc.number)!.results.push({
          shooter: entry.shooter,
          divisionCode: entry.divisionCode,
          classification: null,
          powerFactor: null,
          points: raw.stagePoints,
          penalties: null,
          timeSeconds: null,
          hitFactor: null,
          stagePoints: raw.stagePoints,
          stagePercentage: 0, // se completa en withStagePlacings
          place: 0, // se completa en withStagePlacings
          hits: raw.hits,
          isDq: raw.isDq,
        });
      }
    }
  }

  // Ordenar por número de stage y calcular placings dentro de cada división.
  return Array.from(stageMap.values())
    .sort((a, b) => (a.stageNumber ?? 0) - (b.stageNumber ?? 0))
    .map(withStagePlacings);
}

/**
 * Asigna `place` y `stagePercentage` a cada result, agrupando por división.
 * Los DQs van al final con percentage 0 (mismo criterio que el resto del
 * sistema).
 */
function withStagePlacings(stage: ParsedStage): ParsedStage {
  const byDiv = new Map<string, ParsedStageResult[]>();
  for (const r of stage.results) {
    const list = byDiv.get(r.divisionCode);
    if (list) list.push(r);
    else byDiv.set(r.divisionCode, [r]);
  }

  for (const list of byDiv.values()) {
    const valid = list.filter((r) => !r.isDq);
    valid.sort((a, b) => b.stagePoints - a.stagePoints);
    const best = valid[0]?.stagePoints ?? 0;

    let place = 1;
    for (const r of valid) {
      r.place = place++;
      r.stagePercentage = best > 0 ? (r.stagePoints / best) * 100 : 0;
    }
    // Los DQ quedan con place=0 y percentage=0 que ya pusimos por default.
  }

  return stage;
}

// ---------------------------------------------------------------------------
// Title / date
// ---------------------------------------------------------------------------

/**
 * Busca en las filas previas al header un texto que tenga formato
 * "Nombre del match - DD/MM/YY" (o YYYY).
 *
 * Si no encuentra, devuelve un fallback razonable.
 */
function extractTitle(rowsAbove: string[][]): { matchName: string; date: string } {
  const titleRegex = /^(.*?)\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*$/;
  for (const cells of rowsAbove) {
    for (const cell of cells) {
      const value = cell.trim();
      if (!value) continue;
      const m = value.match(titleRegex);
      if (m) {
        const [, rawName, dd, mm, yy] = m;
        return {
          matchName: rawName!.trim(),
          date: toIsoDate(dd!, mm!, yy!),
        };
      }
    }
  }
  return { matchName: "Match FBI", date: today() };
}

function toIsoDate(dd: string, mm: string, yy: string): string {
  const day = dd.padStart(2, "0");
  const month = mm.padStart(2, "0");
  // Año de 2 dígitos: asumimos siglo 21 (DD/MM/YY del 2000-2099).
  const year = yy.length === 2 ? `20${yy}` : yy.padStart(4, "0");
  return `${year}-${month}-${day}`;
}

function today(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// CSV row parser (mínimo, soporta comillas con comas embebidas)
// ---------------------------------------------------------------------------

function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        out.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  out.push(current);
  return out;
}

// ---------------------------------------------------------------------------
// Normalización (FBI-específica: case-insensitive + NFC para comparar headers
// con/sin acentos en planillas variadas)
// ---------------------------------------------------------------------------

function normalize(value: string | undefined): string {
  return (value ?? "").normalize("NFC").trim().toLowerCase();
}
