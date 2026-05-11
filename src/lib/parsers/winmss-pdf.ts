import { DISCIPLINE } from "../disciplines";
import type {
  ParsedMatch,
  ParsedMatchEntry,
  ParsedStage,
  ParsedStageResult,
} from "../types/match";
import { extractClubFromTitle } from "./shared";

/**
 * Parser para PDFs WinMSS (formato usado por ipsc.org.ar para archivos
 * históricos de Tiro Práctico antes de PractiScore).
 *
 * Soporta dos tipos de archivo, con la misma estructura interna:
 *  - **Overall** ("XX -- Overall Match Results"): una página por división
 *    con el ranking general + entries.
 *  - **Stages** ("XX -- Overall Stage Results" + "Stage N -- Etapa N"):
 *    una página por (división × stage) con stage_points/percent/factor.
 *
 * El usuario sube los dos PDFs por separado: el overall crea el match,
 * el stages se mergea al match existente vía el path que ya hicimos para
 * Steel/FBI (`importMatchOverall` con re-upload).
 *
 * Diseño:
 *  - `parseWinmssText(pages)`: pure function — recibe páginas ya extraídas
 *    como texto. Tests pueden pasar fixtures de texto sin necesitar PDFs.
 *  - `parseWinmssPdf(data)`: wrapper async que llama a `pdf-parse` para
 *    extraer el texto y delega a `parseWinmssText`.
 */

/** Una página de un PDF, en el shape que devuelve `pdf-parse` v2. */
export interface WinmssPage {
  num: number;
  text: string;
}

const SPANISH_MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

// PDFs generados por ESS (Electronic Scoring System) usan meses en inglés.
// Acepta nombre completo y abreviado.
const ENGLISH_MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/**
 * Mapea el nombre de la sección que aparece en el PDF (división) al
 * `code` de la tabla `divisions` de IPSC.
 *
 * Las variantes "SG <X>" (Shotgun) reusan los códigos genéricos de
 * pistola — el usuario explícitamente pidió no separar por arma porque
 * conceptualmente son las mismas divisiones.
 *
 * Si aparece una división que no está acá, la sección se ignora con un
 * warning y el resto del archivo sigue importándose.
 */
const DIVISION_NAME_TO_CODE: Record<string, string> = {
  OPEN: "O",
  "SG OPEN": "O",
  STANDARD: "S",
  "SG STANDARD": "S",
  "STANDARD MANUAL": "SM",
  "SG STANDARD MANUAL": "SM",
  PRODUCTION: "P",
  "PRODUCTION OPTICS": "PO",
  PCC: "PCC",
  "PCC OPTIC": "PCCO",
  "PCC OPTICS": "PCCO",
  "CARRY OPTICS": "CO",
  // ESS llama "OPTICS" a Carry Optics. Ambas mapean al mismo code.
  OPTICS: "CO",
  REVOLVER: "R",
  CLASSIC: "CL",
  "SG CLASSIC": "CL",
  MODIFIED: "MS",
  // TFABA-specific: sección genérica de pistola (no se subdivide en
  // eventos sociales). Ver migración 0013.
  PISTOLA: "PIS",
  // ESS usa "PC IRON" (Pistol Caliber sin óptica) y "PC OPTICS"
  // (con óptica). Equivalentes a PCC y PCCO respectivamente.
  "PC IRON": "PCC",
  "PC OPTICS": "PCCO",
};

// Tokens cortos uppercase que aparecen como columnas de metadata en las
// filas de overall (Cat, Reg, Cls, ICS). Usamos sets explícitos en lugar
// de heuristics de longitud para no confundir un apellido en mayúsculas
// (ej. "EMILIO") con metadata.
const KNOWN_CATEGORIES = new Set(["S", "SS", "GS", "J", "L"]);
const KNOWN_REGIONS = new Set([
  "ARG",
  "CAN",
  "USA",
  "BRA",
  "URU",
  "CHI",
  "PAR",
  "BOL",
]);
const KNOWN_CLASSIFICATIONS = new Set(["GM", "M", "A", "B", "C", "D", "U"]);
const KNOWN_ICS = new Set(["RO"]);

/**
 * Heurística de detección. Un PDF es WinMSS si tiene una sección
 * "Overall (Match|Stage) Results" más una línea "Printed <mes> <día>"
 * en español. Los dos juntos descartan PDFs random sin riesgo de falsos
 * positivos.
 *
 * No usamos el footer "World Classification System used" porque solo
 * aparece en los archivos overall, no en stages.
 */
export function isWinmssFormat(text: string): boolean {
  // Soporta tres formatos:
  //  - WinMSS clásico: "X -- Overall Match Results", mes en español.
  //  - ESS overall: "X - Results Overall", "Printed:" con mes en inglés.
  //  - ESS by-stage: "X - Results by Stage" + subheader "Stage <Div> - Stage NN".
  const hasHeader =
    /Overall\s+(Match|Stage)\s+Results/i.test(text) ||
    /-\s+Results\s+(Overall|Stage\s+\d+|by\s+Stage)/i.test(text);
  const hasPrinted = /Printed[:\s]+[A-Za-záéíóúñ]+\s+\d{1,2}/i.test(text);
  return hasHeader && hasPrinted;
}

/**
 * Parsea las páginas de texto extraídas de un PDF WinMSS. Detecta
 * automáticamente si es overall, stages, o (raro) ambos en el mismo
 * archivo. La división de cada sección se mapea al `code` de DB.
 */
export function parseWinmssText(pages: WinmssPage[]): ParsedMatch {
  if (pages.length === 0) {
    throw new Error("PDF vacío: no se encontraron páginas.");
  }

  const matchEntries: ParsedMatchEntry[] = [];
  const stagesByNum = new Map<number, ParsedStageResult[]>();

  let matchName = "";
  let matchDate = "";

  for (const page of pages) {
    const parsed = parsePage(page.text);
    if (!parsed) {
      // Diagnóstico: la página no se mapeó a ninguna división conocida o no
      // tiene header. Dejamos snippet en logs para investigar.
      console.warn(
        `[winmss-pdf] página ${page.num} descartada (sin división reconocida). Texto inicio: ${page.text
          .slice(0, 300)
          .replace(/\s+/g, " ")
          .trim()}`,
      );
      continue;
    }

    matchName = matchName || parsed.matchName;
    matchDate = matchDate || parsed.date;

    if (parsed.kind === "overall") {
      if (parsed.entries.length === 0) {
        console.warn(
          `[winmss-pdf] página ${page.num} (${parsed.divisionCode}): 0 filas parseadas. Texto: ${page.text
            .slice(0, 500)
            .replace(/\s+/g, " ")
            .trim()}`,
        );
      }
      for (const entry of parsed.entries) {
        matchEntries.push({
          ...entry,
          divisionCode: parsed.divisionCode,
        });
      }
    } else if (parsed.kind === "stage") {
      if (parsed.results.length === 0) {
        console.warn(
          `[winmss-pdf] página ${page.num} (${parsed.divisionCode}, stage ${parsed.stageNumber}): 0 resultados parseados. Texto: ${page.text
            .slice(0, 500)
            .replace(/\s+/g, " ")
            .trim()}`,
        );
      }
      let bucket = stagesByNum.get(parsed.stageNumber);
      if (!bucket) {
        bucket = [];
        stagesByNum.set(parsed.stageNumber, bucket);
      }
      for (const result of parsed.results) {
        bucket.push({
          ...result,
          divisionCode: parsed.divisionCode,
        });
      }
    } else {
      // DQ page: las entries ya traen su divisionCode resuelto (la división
      // viene en la fila misma, no en un section header).
      if (parsed.entries.length === 0) {
        console.warn(
          `[winmss-pdf] página ${page.num} (DQ): 0 filas parseadas. Texto: ${page.text
            .slice(0, 500)
            .replace(/\s+/g, " ")
            .trim()}`,
        );
      }
      for (const entry of parsed.entries) {
        matchEntries.push(entry);
      }
    }
  }

  if (!matchName) {
    const snippet = (pages[0]?.text ?? "").slice(0, 300).replace(/\s+/g, " ");
    throw new Error(
      `No se pudo extraer el nombre del match del PDF. ¿Es un archivo WinMSS válido? Inicio del texto: "${snippet}"`,
    );
  }
  if (!matchDate) {
    throw new Error(
      "No se pudo extraer la fecha del PDF (esperaba 'Printed mes DD, YYYY').",
    );
  }
  // Si no extraemos ni entries ni stages, abortamos en lugar de crear un
  // match vacío. Pasaba ocasionalmente con PDFs cuyas filas `unpdf` extrae
  // en orden column-major (cada celda en lugar de cada row) y las regex
  // de fila no matchean nada.
  if (matchEntries.length === 0 && stagesByNum.size === 0) {
    throw new Error(
      "El PDF se identificó como WinMSS pero no se pudo extraer ninguna fila de resultados. Probá con otro archivo o avisame con el nombre del torneo.",
    );
  }

  const stages: ParsedStage[] = Array.from(stagesByNum.entries())
    .sort(([a], [b]) => a - b)
    .map(([num, results]) => ({
      stageNumber: num,
      name: `Stage ${num}`,
      results,
    }));

  // En WinMSS la columna "Reg" del PDF es la federación IPSC del
  // tirador (ARG, CAN), no su club — por eso no la usamos para
  // match.region. El club suele estar en el título: "TFABA 1er SOCIAL
  // ESCOPETA" → "TFABA". Si no lo extraemos, queda null y el usuario
  // lo asigna a mano con "Editar club".
  const region = extractClubFromTitle(matchName);

  return {
    discipline: DISCIPLINE.IPSC,
    source: "winmss_pdf",
    name: matchName,
    date: matchDate,
    region,
    matchEntries,
    stages,
    generatedBy: "WinMSS",
  };
}

interface OverallPageResult {
  kind: "overall";
  divisionCode: string;
  matchName: string;
  date: string;
  entries: Array<Omit<ParsedMatchEntry, "divisionCode">>;
}

interface StagePageResult {
  kind: "stage";
  divisionCode: string;
  stageNumber: number;
  matchName: string;
  date: string;
  results: Array<Omit<ParsedStageResult, "divisionCode">>;
}

/**
 * Reporte "Disqualified Shooters" que WinMSS genera como página aparte.
 * No tiene header "Overall ... Results" pero sí "Disqualified Shooters" y
 * filas con shape `<bib> <División> <Apellido>, <Nombre>` (la división
 * viene en la fila misma, no en un section header). Por eso cada entry
 * ya trae su `divisionCode` resuelto.
 */
interface DqPageResult {
  kind: "dq";
  matchName: string;
  date: string;
  entries: ParsedMatchEntry[];
}

function parsePage(
  text: string,
): OverallPageResult | StagePageResult | DqPageResult | null {
  // Reporte de DQs (WinMSS clásico genera una página aparte con la lista
  // de tiradores DQ). No tiene "Overall ... Results" pero sí "Disqualified
  // Shooters". Lo detectamos primero porque su layout no encaja con
  // ninguno de los otros formatos.
  //
  // Devolvemos matchName/date vacíos para que esta página no contribuya al
  // nombre del match (el title/fecha vienen de las páginas overall que se
  // procesan antes).
  if (/Disqualified\s+Shooters/i.test(text)) {
    return {
      kind: "dq",
      matchName: "",
      date: "",
      entries: parseDqPageRows(text),
    };
  }

  // Tres formatos de páginas con ranking:
  //  - WinMSS clásico: "X -- Overall (Match|Stage) Results" + filas 8-col en stages.
  //  - ESS overall: "X - Results Overall"
  //  - ESS by-stage: "X - Results by Stage" + subheader "Stage <Div> - Stage NN"
  //    con filas 5-col (mismo shape que overall — no hay raw hits/time/factor).
  const overallMatch =
    /([A-Z][A-Z\s]*?)\s*--\s*Overall\s+Match\s+Results/i.exec(text) ??
    /([A-Z][A-Z\s]*?)\s+-\s*Results\s+Overall(?!\s+Stage)/i.exec(text);
  const stageHeaderMatch =
    /([A-Z][A-Z\s]*?)\s*--\s*Overall\s+Stage\s+Results/i.exec(text) ??
    /([A-Z][A-Z\s]*?)\s+-\s*Results\s+Stage\s+\d+/i.exec(text);
  const essByStageMatch =
    /([A-Z][A-Z\s]*?)\s+-\s*Results\s+by\s+Stage/i.exec(text);

  if (!overallMatch && !stageHeaderMatch && !essByStageMatch) return null;

  const divisionRaw = (
    overallMatch?.[1] ??
    stageHeaderMatch?.[1] ??
    essByStageMatch?.[1] ??
    ""
  )
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
  // Probamos lookup con el texto tal como vino, y también sin espacios.
  // Ej.: en algunos PDFs `pdfjs` rompe la palabra "PISTOLA" en dos items
  // ("P" + "ISTOLA") por kerning, y nuestra reconstrucción posicional los
  // junta con un espacio. Sacar espacios cubre ese caso sin afectar
  // divisiones legítimamente multi-palabra (que matchean en el primer
  // lookup).
  const divisionCode =
    DIVISION_NAME_TO_CODE[divisionRaw] ??
    DIVISION_NAME_TO_CODE[divisionRaw.replace(/\s+/g, "")];
  if (!divisionCode) {
    // División desconocida: ignoramos esta página silenciosamente. El
    // resto del PDF sigue siendo válido.
    return null;
  }

  const matchName = extractMatchName(text);
  const date = extractDate(text);

  if (overallMatch) {
    return {
      kind: "overall",
      divisionCode,
      matchName,
      date,
      entries: parseOverallRows(text),
    };
  }

  const stageNum = extractStageNumber(text);
  if (stageNum == null) return null;

  // ESS by-stage usa filas de 5 columnas (place, %, points, bib, name) — el
  // mismo shape que overall, no las 8 columnas del stage WinMSS clásico (que
  // incluyen ptsHit, time, factor).
  const results = essByStageMatch
    ? parseEssStageRows(text)
    : parseStageRows(text);

  return {
    kind: "stage",
    divisionCode,
    stageNumber: stageNum,
    matchName,
    date,
    results,
  };
}

/**
 * Saca el título del match de la página. WinMSS suele ponerlo en una
 * línea junto con "Printed mayo X, YYYY" — primero stripeamos cualquier
 * marker (Printed, headers de columnas, etc.), después dedup si quedó
 * el título duplicado, y nos quedamos con la primera línea que sobra.
 */
function extractMatchName(text: string): string {
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Stripeamos noise inline en vez de skip-line — algunos PDFs concatenan
  // el título con otros elementos en la misma línea ("Stage 1 -- Etapa 1
  // TFABA 1er SOCIAL ESCOPETA Printed ..."), y skip-line los descartaba
  // junto con el título.
  const candidates: string[] = [];
  for (const raw of lines) {
    const stripped = raw
      .replace(/[A-Z][A-Z0-9\s]*?\s*--\s*Overall\s+(Match|Stage)\s+Results/gi, "")
      .replace(/Stage\s+\d+\s*--\s*Etapa\s*\d*/gi, "")
      .replace(
        /Printed\s+[a-záéíóúñ]+\s+\d{1,2},?(\s+\d{4}(\s+at\s+[\d:]+)?)?/gi,
        "",
      )
      .replace(/World\s+Classification\s+System(\s+used)?/gi, "")
      .replace(/ESS\s*-\s*Electronic\s+Scoring\s+System/gi, "")
      .replace(/Page\s+\d+/gi, "")
      .replace(/\d+\s+of\s+\d+/g, "") // ESS footer "1 of 8"
      .replace(/\d{4}\s+at\s+[\d:]+/g, "")
      .replace(/\d{4}\s+\d{1,2}:\d{2}(:\d{2})?/g, "") // ESS "2026 21:33:24"
      // ESS header: "X - Results Overall" o "X - Results Stage N" o
      // "X - Results by Stage" (formato stages ESS).
      .replace(
        /[A-Z][A-Z0-9\s]*?\s+-\s*Results\s+(Overall|Stage\s+\d+|by\s+Stage)/gi,
        "",
      )
      // ESS by-stage subheader: "Stage Classic - Stage 01" (donde "Classic"
      // es el nombre de la división y "01" el número del stage).
      .replace(/Stage\s+[A-Za-z][A-Za-z\s]*?\s+-\s*Stage\s+\d+/gi, "")
      .replace(
        /Printed:?\s+[A-Za-z]+\s+\d{1,2},?(\s+\d{4})?(\s+[\d:]+)?/gi,
        "",
      )
      .replace(/\s+/g, " ")
      .trim();

    if (!stripped) continue;
    if (/^%\s+Points/i.test(stripped)) continue;
    if (/^HIT\s+STAGE/i.test(stripped)) continue;
    if (/^PTS\s+TIME/i.test(stripped)) continue;
    if (/^STAGE\s+(POINTS|PERCENT)/i.test(stripped)) continue;
    if (/^COMPETITOR/i.test(stripped)) continue;
    // Filas de datos: place seguido de un valor numérico (decimal o entero)
    // con un espacio entre medio — patrón "1 100.00 640.0000 ..." o "1 110
    // 20,78 ...". Antes filtrábamos por `^\d` pero eso rompe títulos como
    // "3RA FECHA COPA SOCIAL" (TF Lomas de Zamora), que empiezan con dígito
    // pero no son filas — el "3" no va seguido de espacio.
    if (/^\s*\d+\s+\d/.test(stripped)) continue;
    // Filas DQ del formato ESS (sin columnas %/points): terminan en " DQ".
    // Ej.: "39 SGUERA, Santino Eduardo DQ".
    if (/\sDQ\s*$/i.test(stripped)) continue;
    // Línea con muchos tokens de header de columna concatenados — ocurre
    // cuando unpdf extrae la tabla column-major y repite cada header N
    // veces sin espacios entre ellos, ej:
    //   "PointsPointsPointsPoints%%%% CompetitorCompetitor... Reg... Cat..."
    // El test es robusto a orden/separadores: si la línea contiene ≥3 de
    // los nombres de columna conocidos, la descartamos.
    if (looksLikeColumnHeaders(stripped)) continue;
    candidates.push(dedupeTitle(stripped));
  }

  if (candidates.length === 0) return "";
  // El título es la línea con más sustancia — los fragmentos sueltos suelen
  // ser cortos ("Page", residuos de stripping). Empata con el primero que
  // llegó al máximo, así que en archivos overall normales sigue ganando la
  // primera ocurrencia del título.
  return candidates.reduce((a, b) => (b.length > a.length ? b : a));
}

// Nombres de columna que aparecen en las tablas de WinMSS (overall + stages).
// Se chequean como substrings case-insensitive para tolerar concatenaciones
// sin espacios producidas por unpdf en algunos PDFs.
const COLUMN_HEADER_TOKENS = [
  "Points",
  "Competitor",
  "Stage",
  "Factor",
  "Percent",
];

/**
 * `true` si la línea parece compuesta principalmente por nombres de columna
 * (3+ ocurrencias de tokens conocidos). Usamos esto para descartar líneas
 * de header tabular cuando `unpdf` las extrae en formato column-major y
 * concatena los nombres sin espacios.
 */
function looksLikeColumnHeaders(line: string): boolean {
  const lower = line.toLowerCase();
  let count = 0;
  for (const token of COLUMN_HEADER_TOKENS) {
    if (lower.includes(token.toLowerCase())) count++;
  }
  return count >= 3;
}

/**
 * Algunos PDFs WinMSS repiten el título N veces en la misma línea
 * (típicamente 2 o 4), con o sin espacio entre repeticiones — ej.
 * "TFABA 1er SOCIAL ESCOPETATFABA 1er SOCIAL ESCOPETA..." (sin espacio)
 * o "TFABA 1er SOCIAL ESCOPETA TFABA 1er SOCIAL ESCOPETA" (con espacio).
 *
 * Buscamos el prefijo más corto que, repetido K veces (con o sin separador
 * de espacio entre repeticiones), reproduce la línea entera.
 */
function dedupeTitle(line: string): string {
  const n = line.length;
  // Probamos longitudes de prefijo crecientes — el más corto gana.
  for (let len = 1; len <= Math.floor(n / 2); len++) {
    const prefix = line.slice(0, len);
    if (matchesRepetition(line, prefix)) return prefix.trim();
  }
  return line;
}

function matchesRepetition(line: string, prefix: string): boolean {
  let i = prefix.length;
  while (i < line.length) {
    // Saltamos espacios opcionales entre repeticiones.
    if (line[i] === " ") i++;
    if (line.slice(i, i + prefix.length) !== prefix) return false;
    i += prefix.length;
  }
  return i === line.length;
}

function extractDate(text: string): string {
  // Prioridad 1: fecha embebida en el título con formato "DD MES YYYY"
  // (ej. "SEGUNDO SOCIAL PISTOLA 9 MAYO 2026"). Es la fecha real del
  // certamen — la del "Printed:" puede ser días después (cuando se generó
  // el PDF) y eso confunde al tirador.
  //
  // El orden de los tokens (DD primero) la distingue del formato de
  // "Printed: May 11, 2026" (MONTH primero), así que la regex no se
  // confunde aunque ambas líneas estén en el mismo texto.
  const titleMatch = /\b(\d{1,2})\s+([A-Za-záéíóúñ]+)\s+(\d{4})\b/.exec(text);
  if (titleMatch) {
    const day = parseInt(titleMatch[1]!, 10);
    const name = titleMatch[2]!.toLowerCase();
    const month = SPANISH_MONTHS[name] ?? ENGLISH_MONTHS[name];
    if (month && day >= 1 && day <= 31) {
      return `${titleMatch[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // Fallback: fecha de "Printed:" (formato "MONTH DD, YYYY").
  //  - WinMSS clásico: "Printed mayo 2, 2026" (sin colon, mes en español)
  //  - ESS: "Printed: May 11, 2026" (con colon, mes en inglés)
  const m =
    /Printed[:\s]+([A-Za-záéíóúñ]+)\s+(\d{1,2}),?\s+(\d{4})/i.exec(text);
  if (!m) return "";
  const name = m[1]!.toLowerCase();
  const month = SPANISH_MONTHS[name] ?? ENGLISH_MONTHS[name];
  if (!month) return "";
  return `${m[3]}-${String(month).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

function extractStageNumber(text: string): number | null {
  // WinMSS clásico: "Stage 1 -- Etapa 1"
  const winmss = /Stage\s+(\d+)\s*--/i.exec(text);
  if (winmss) return parseInt(winmss[1]!, 10);
  // ESS by-stage: "Stage Classic - Stage 01" (subheader donde el primer
  // token después de "Stage" es el nombre de la división, y el número
  // viene en el segundo "Stage NN").
  const ess = /Stage\s+[A-Za-z][A-Za-z\s]*?\s+-\s*Stage\s+(\d+)/i.exec(text);
  if (ess) return parseInt(ess[1]!, 10);
  return null;
}

/**
 * Filas de overall: `<place> <%> <points> <bib#> <Apellido, Nombre> [meta...]`
 * Ejemplo: "1 100,00 525,0000 61 El Jaouhari, Ignacio CAN"
 */
function parseOverallRows(
  text: string,
): Array<Omit<ParsedMatchEntry, "divisionCode">> {
  // Acepta decimales con coma (WinMSS, es-AR) o punto (ESS, en-US).
  const ROW_RE = /^\s*(\d+)\s+(\d+[.,]\d+)\s+(\d+[.,]\d+)\s+(\d+)\s+(.+?)\s*$/;
  // Filas DQ del formato ESS: no traen columnas de %/points/place — solo
  // dorsal, nombre y el marker "DQ" al final. Ej: "39 SGUERA, Santino DQ".
  const DQ_ROW_RE = /^\s*(\d+)\s+(.+?)\s+DQ\s*$/;
  const out: Array<Omit<ParsedMatchEntry, "divisionCode">> = [];
  for (const line of text.split(/\n/)) {
    const m = ROW_RE.exec(line);
    if (m) {
      const place = parseInt(m[1]!, 10);
      const matchPercentage = parseDecimalComma(m[2]!);
      const matchPoints = parseDecimalComma(m[3]!);
      const { name, meta } = splitNameFromMeta(m[5]!);
      if (!name) continue;
      out.push({
        shooter: {
          fullName: name,
          memberNumber: null,
          // La columna "Reg" del PDF es la federación regional IPSC del
          // tirador (ARG, CAN, etc.) — la guardamos como region del shooter.
          region: meta.reg ?? null,
        },
        classification: meta.cls ?? null,
        powerFactor: null,
        category: meta.cat ?? null,
        place,
        matchPoints,
        matchPercentage,
        totalTimeSeconds: null,
        hits: null, // IPSC scoring es hit factor, no impactos.
        // Si el tirador terminó con 0 puntos, lo marcamos como DQ.
        isDq: matchPoints === 0,
      });
      continue;
    }
    const dq = DQ_ROW_RE.exec(line);
    if (dq) {
      // Filas DQ del formato ESS. No tenemos place/points/% reales — los
      // dejamos en 0 y la UI los muestra con badge "DQ" porque isDq=true.
      // El nombre puede o no tener Cat/Reg trailing; reusamos el splitter
      // de meta para limpiar.
      const { name, meta } = splitNameFromMeta(dq[2]!);
      if (!name) continue;
      out.push({
        shooter: {
          fullName: name,
          memberNumber: null,
          region: meta.reg ?? null,
        },
        classification: meta.cls ?? null,
        powerFactor: null,
        category: meta.cat ?? null,
        place: 0,
        matchPoints: 0,
        matchPercentage: 0,
        totalTimeSeconds: null,
        hits: null,
        isDq: true,
      });
    }
  }
  return out;
}

/**
 * Filas de stage: `<place> <pts> <time> <factor> <stage_pts> <stage_%> <bib#> <name>`
 * Ejemplo: "1 110 20,78 5,2936 110,0000 100,00 40 GARNICA RIVEROS, Jorge Efrain"
 */
function parseStageRows(
  text: string,
): Array<Omit<ParsedStageResult, "divisionCode">> {
  // Acepta decimales con coma (WinMSS, es-AR) o punto (ESS, en-US).
  const ROW_RE =
    /^\s*(\d+)\s+(\d+)\s+(\d+[.,]\d+)\s+(\d+[.,]\d+)\s+(\d+[.,]\d+)\s+(\d+[.,]\d+)\s+(\d+)\s+(.+?)\s*$/;
  const out: Array<Omit<ParsedStageResult, "divisionCode">> = [];
  for (const line of text.split(/\n/)) {
    const m = ROW_RE.exec(line);
    if (!m) continue;
    const place = parseInt(m[1]!, 10);
    const ptsHit = parseInt(m[2]!, 10);
    const timeSec = parseDecimalComma(m[3]!);
    const hitFactor = parseDecimalComma(m[4]!);
    const stagePoints = parseDecimalComma(m[5]!);
    const stagePct = parseDecimalComma(m[6]!);
    const { name } = splitNameFromMeta(m[8]!);
    if (!name) continue;

    // DQ del stage: o bien el tirador acumuló 0 hits (factor=0), o el
    // factor es 0 con tiempo > 0 (rule violation). En ambos casos el
    // stage cuenta 0 puntos y queda al final del ranking.
    const isDq = hitFactor === 0;

    out.push({
      shooter: {
        fullName: name,
        memberNumber: null,
        region: null,
      },
      classification: null,
      powerFactor: null,
      points: ptsHit,
      penalties: null,
      timeSeconds: timeSec > 0 ? timeSec : null,
      hitFactor: hitFactor > 0 ? hitFactor : null,
      stagePoints,
      stagePercentage: stagePct,
      place: isDq ? 0 : place,
      hits: null,
      isDq,
    });
  }
  return out;
}

/**
 * Filas de stage en formato ESS by-Stage: `<place> <%> <points> <bib#> <name>`.
 * Mismo shape que las filas de overall (5 columnas) — ESS by-stage no expone
 * raw hits, time, ni hit factor. Sólo posición, % del stage y puntos del stage.
 *
 * Ejemplo: "1 100.00 155.0000 58 SILVA, Lucas ARG"
 */
function parseEssStageRows(
  text: string,
): Array<Omit<ParsedStageResult, "divisionCode">> {
  const ROW_RE = /^\s*(\d+)\s+(\d+[.,]\d+)\s+(\d+[.,]\d+)\s+(\d+)\s+(.+?)\s*$/;
  const DQ_ROW_RE = /^\s*(\d+)\s+(.+?)\s+DQ\s*$/;
  const out: Array<Omit<ParsedStageResult, "divisionCode">> = [];
  for (const line of text.split(/\n/)) {
    const m = ROW_RE.exec(line);
    if (m) {
      const place = parseInt(m[1]!, 10);
      const stagePct = parseDecimalComma(m[2]!);
      const stagePoints = parseDecimalComma(m[3]!);
      const { name } = splitNameFromMeta(m[5]!);
      if (!name) continue;
      const isDq = stagePoints === 0;
      out.push({
        shooter: { fullName: name, memberNumber: null, region: null },
        classification: null,
        powerFactor: null,
        points: null,
        penalties: null,
        timeSeconds: null,
        hitFactor: null,
        stagePoints,
        stagePercentage: stagePct,
        place: isDq ? 0 : place,
        hits: null,
        isDq,
      });
      continue;
    }
    const dq = DQ_ROW_RE.exec(line);
    if (dq) {
      const { name } = splitNameFromMeta(dq[2]!);
      if (!name) continue;
      out.push({
        shooter: { fullName: name, memberNumber: null, region: null },
        classification: null,
        powerFactor: null,
        points: null,
        penalties: null,
        timeSeconds: null,
        hitFactor: null,
        stagePoints: 0,
        stagePercentage: 0,
        place: 0,
        hits: null,
        isDq: true,
      });
    }
  }
  return out;
}

/**
 * Filas del reporte "Disqualified Shooters" de WinMSS clásico: el shape
 * es `<bib> <Division (1-2 palabras)> <Apellido>, <Nombre>`. La división
 * viene en la fila — no en un section header — así que la resolvemos
 * acá greedy-matching contra DIVISION_NAME_TO_CODE (primero 3 palabras,
 * después 2, después 1).
 *
 * Ejemplo: "51 Production Prieto, Gonzalo Martin"
 *          → bib=51, división=Production (→ P), apellido="Prieto",
 *            nombre="Gonzalo Martin".
 *
 * Devolvemos `ParsedMatchEntry` con isDq=true, place/points/% en 0 (no los
 * conocemos: el reporte de DQs solo lista nombres). Si la fila no matchea
 * (línea de footer, header de tabla, etc.) se ignora silenciosamente.
 */
function parseDqPageRows(text: string): ParsedMatchEntry[] {
  const out: ParsedMatchEntry[] = [];
  for (const rawLine of text.split(/\n/)) {
    const line = rawLine.trim();
    // Fila empieza con bib (un entero) seguido de contenido con coma.
    const m = /^(\d+)\s+(.+?,\s*.+)$/.exec(line);
    if (!m) continue;
    const rest = m[2]!;
    const commaIdx = rest.indexOf(",");
    if (commaIdx < 0) continue;
    const beforeComma = rest.slice(0, commaIdx).trim();
    // Mantenemos la coma + espacio en la parte "después" para reconstruir
    // el fullName "Apellido, Nombre" como aparece en el resto del parser.
    const afterComma = rest.slice(commaIdx);

    const tokens = beforeComma.split(/\s+/);
    // Necesitamos al menos división (1+ palabras) + apellido (1+ palabras).
    if (tokens.length < 2) continue;

    // Greedy: probamos primero nombres de división largos (hasta 3 palabras
    // por las dudas) y bajamos. El primer match gana.
    let divisionCode: string | null = null;
    let apellido = "";
    for (
      let divLen = Math.min(3, tokens.length - 1);
      divLen >= 1;
      divLen--
    ) {
      const divCandidate = tokens.slice(0, divLen).join(" ").toUpperCase();
      const code =
        DIVISION_NAME_TO_CODE[divCandidate] ??
        DIVISION_NAME_TO_CODE[divCandidate.replace(/\s+/g, "")];
      if (code) {
        divisionCode = code;
        apellido = tokens.slice(divLen).join(" ");
        break;
      }
    }
    if (!divisionCode || !apellido) continue;

    const fullName = `${apellido}${afterComma}`.trim();
    out.push({
      shooter: { fullName, memberNumber: null, region: null },
      divisionCode,
      classification: null,
      powerFactor: null,
      category: null,
      place: 0,
      matchPoints: 0,
      matchPercentage: 0,
      totalTimeSeconds: null,
      hits: null,
      isDq: true,
    });
  }
  return out;
}

function parseDecimalComma(value: string): number {
  // WinMSS usa coma decimal (formato es-AR): "100,00" → 100, "525,0000" → 525.
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

interface ParsedMeta {
  cat?: string;
  reg?: string;
  cls?: string;
  ics?: string;
}

/**
 * Las filas de overall tienen el nombre con "Apellido, Nombre" seguido de
 * tokens cortos uppercase (Cat, Reg, Cls, ICS). Caminamos desde el final
 * recogiendo tokens conocidos y consideramos lo demás parte del nombre.
 *
 * Esto evita confundir nombres en mayúsculas (ej. "FORNS, MARTIN EMILIO")
 * con metadata: "EMILIO" no figura en ningún set conocido y por lo tanto
 * frena la cosecha de tokens trailing.
 */
function splitNameFromMeta(rest: string): { name: string; meta: ParsedMeta } {
  const tokens = rest.trim().split(/\s+/);
  const meta: ParsedMeta = {};
  let i = tokens.length;
  while (i > 0) {
    const t = tokens[i - 1]!;
    if (
      KNOWN_CATEGORIES.has(t) ||
      KNOWN_REGIONS.has(t) ||
      KNOWN_CLASSIFICATIONS.has(t) ||
      KNOWN_ICS.has(t)
    ) {
      i--;
      continue;
    }
    break;
  }
  for (const t of tokens.slice(i)) {
    if (KNOWN_CATEGORIES.has(t)) meta.cat = t;
    else if (KNOWN_REGIONS.has(t)) meta.reg = t;
    else if (KNOWN_CLASSIFICATIONS.has(t)) meta.cls = t;
    else if (KNOWN_ICS.has(t)) meta.ics = t;
  }
  const name = tokens.slice(0, i).join(" ").trim();
  return { name, meta };
}

/**
 * Wrapper async: recibe el binario del PDF y devuelve el ParsedMatch.
 *
 * Usamos `unpdf` (no `pdf-parse`) porque está hecho específicamente para
 * runtimes serverless (Vercel/Cloudflare) — `pdf-parse` v2 internamente
 * carga `pdfjs-dist` con build de browser, que requiere globals como
 * `DOMMatrix` que no existen en Node y rompe el import en producción.
 *
 * Reconstruimos el texto de cada página agrupando los items de pdfjs por
 * coordenada Y (filas) y ordenando por X (columnas). `unpdf.extractText`
 * solo concatena strings en el orden que están guardados en el PDF, que
 * puede ser column-major y romper completamente las regex de fila.
 *
 * Carga `unpdf` dinámicamente (~600KB) para no inflar el bundle de
 * import/page hasta que el usuario efectivamente sube un PDF.
 */
export async function parseWinmssPdf(data: Uint8Array): Promise<ParsedMatch> {
  const tLoadStart = Date.now();
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(data);
  const tLoad = Date.now() - tLoadStart;

  let tGetTextContent = 0;
  let tReconstruct = 0;
  const pages: WinmssPage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tGtc = Date.now();
    const content = await page.getTextContent();
    tGetTextContent += Date.now() - tGtc;
    const tRec = Date.now();
    const text = reconstructTextByPosition(content.items as unknown[]);
    tReconstruct += Date.now() - tRec;
    pages.push({ num: i, text });
  }

  const tParseStart = Date.now();
  const result = parseWinmssText(pages);
  const tParse = Date.now() - tParseStart;

  console.log(
    `[winmss-pdf] pages=${doc.numPages} bytes=${data.byteLength} ` +
      `load=${tLoad}ms getTextContent=${tGetTextContent}ms ` +
      `reconstruct=${tReconstruct}ms parseText=${tParse}ms`,
  );

  return result;
}

/**
 * Reconstruye texto plano a partir de los items con posición de pdfjs.
 *
 * Cada item de `getTextContent()` trae `str` (string) y `transform`
 * (matriz [a, b, c, d, e=x, f=y]). Agrupamos por Y (con tolerancia chica
 * porque el baseline del texto varía dentro de una fila), ordenamos por X
 * dentro de cada fila, y devolvemos las filas en orden top→bottom (Y desc
 * porque en PDF Y crece hacia arriba).
 */
function reconstructTextByPosition(items: unknown[]): string {
  interface Item {
    str: string;
    x: number;
    y: number;
  }
  const parsed: Item[] = [];
  for (const raw of items) {
    if (
      typeof raw !== "object" ||
      raw === null ||
      !("str" in raw) ||
      !("transform" in raw)
    ) {
      continue;
    }
    const r = raw as { str: unknown; transform: unknown };
    if (typeof r.str !== "string" || !Array.isArray(r.transform)) continue;
    if (r.str.trim().length === 0) continue;
    parsed.push({
      str: r.str,
      x: typeof r.transform[4] === "number" ? r.transform[4] : 0,
      y: typeof r.transform[5] === "number" ? r.transform[5] : 0,
    });
  }
  if (parsed.length === 0) return "";

  // Top→bottom, left→right.
  parsed.sort((a, b) => b.y - a.y || a.x - b.x);

  // Agrupamos por Y con tolerancia: items con Y dentro de Y_TOL del primero
  // del grupo van a la misma fila.
  const Y_TOL = 2;
  const rows: Item[][] = [];
  for (const item of parsed) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0]!.y - item.y) <= Y_TOL) {
      last.push(item);
    } else {
      rows.push([item]);
    }
  }
  // Ordenamos por X dentro de cada fila y deduplicamos artefactos de
  // bold-rendering: algunos PDFs simulan texto en negrita dibujando el
  // mismo glyph 2-4 veces con un offset horizontal chico (<1pt). Sin esta
  // dedup el header "% Points Competitor..." sale como "% % % % Points
  // Points Points Points..." y termina contaminando la extracción del
  // título.
  //
  // Estrategia: si dos items consecutivos tienen la MISMA string y la X
  // difiere en menos de X_DEDUP_TOL, asumimos artefacto. Las columnas
  // reales en una tabla están separadas por mucho más (5pt+) así que
  // este threshold no debería pisar contenido legítimo.
  const X_DEDUP_TOL = 2;
  const dedupedRows = rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    const out: Item[] = [];
    for (const item of row) {
      const last = out[out.length - 1];
      if (
        last &&
        last.str === item.str &&
        Math.abs(item.x - last.x) <= X_DEDUP_TOL
      ) {
        continue;
      }
      out.push(item);
    }
    return out;
  });
  return dedupedRows
    .map((row) => row.map((i) => i.str).join(" "))
    .join("\n");
}
