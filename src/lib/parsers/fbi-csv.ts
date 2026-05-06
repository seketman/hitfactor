import type {
  ParsedMatch,
  ParsedMatchEntry,
  ParsedShooter,
} from "@/lib/types/match";

/**
 * Parser para resultados de Tiro FBI exportados desde Google Sheets como CSV.
 *
 * Formato esperado (basado en planillas TFALP):
 *  - Fila con título: "Social N - DD/MM/YY" (o similar con fecha al final)
 *  - Fila de headers: contiene al menos las columnas
 *      Tirador, Club, Categoría, Disciplina, Impactos, Puntos
 *  - Filas de datos: una por (tirador, disciplina). Se descartan filas sin Tirador.
 *
 * Cada `Disciplina` del CSV (Pistola/Revólver/Minirifle/PCC) se mapea a una
 * división de la disciplina FBI. El ranking se calcula **por división**
 * ordenando por Puntos descendente (tiebreak por Impactos), tal como en IPSC.
 * `match_percentage` es relativo al ganador de cada división.
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
    const puntos = parseIntSafe(cells[idxPuntos]);
    const impactos = parseIntSafe(cells[idxImpactos]);
    if (puntos === null) continue;

    const entry: RawEntry = {
      shooter: {
        fullName: (cells[idxTirador] ?? "").trim(),
        memberNumber: null,
        region: cleanClub(cells[idxClub]),
      },
      divisionCode,
      category: cleanCategory(cells[idxCategoria]),
      puntos,
      impactos: impactos ?? 0,
    };
    if (!entry.shooter.fullName) continue;

    const list = byDivision.get(divisionCode);
    if (list) list.push(entry);
    else byDivision.set(divisionCode, [entry]);
  }

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
        isDq: false,
      });
    });
  }

  return {
    discipline: "tiro_fbi",
    source: "fbi_csv",
    name: matchName,
    date,
    region: null,
    matchEntries,
    stages: [],
    generatedBy: null,
  };
}

interface RawEntry {
  shooter: ParsedShooter;
  divisionCode: string;
  category: string | null;
  puntos: number;
  impactos: number;
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
// Helpers de normalización
// ---------------------------------------------------------------------------

function normalize(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFC")
    .trim()
    .toLowerCase();
}

function parseIntSafe(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function cleanCategory(value: string | undefined): string | null {
  const v = (value ?? "").trim();
  return v ? v : null;
}

function cleanClub(value: string | undefined): string | null {
  const v = (value ?? "").trim();
  return v ? v : null;
}
