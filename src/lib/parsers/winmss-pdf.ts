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
  REVOLVER: "R",
  CLASSIC: "CL",
  "SG CLASSIC": "CL",
  MODIFIED: "MS",
  // TFABA-specific: sección genérica de pistola (no se subdivide en
  // eventos sociales). Ver migración 0013.
  PISTOLA: "PIS",
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
  return (
    /Overall\s+(Match|Stage)\s+Results/i.test(text) &&
    /Printed\s+[a-záéíóúñ]+\s+\d{1,2}/i.test(text)
  );
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
    if (!parsed) continue;

    matchName = matchName || parsed.matchName;
    matchDate = matchDate || parsed.date;

    if (parsed.kind === "overall") {
      for (const entry of parsed.entries) {
        matchEntries.push({
          ...entry,
          divisionCode: parsed.divisionCode,
        });
      }
    } else {
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

function parsePage(text: string): OverallPageResult | StagePageResult | null {
  const overallMatch = /([A-Z][A-Z\s]*?)\s*--\s*Overall\s+Match\s+Results/i.exec(
    text,
  );
  const stageHeaderMatch =
    /([A-Z][A-Z\s]*?)\s*--\s*Overall\s+Stage\s+Results/i.exec(text);

  if (!overallMatch && !stageHeaderMatch) return null;

  const divisionRaw = (overallMatch?.[1] ?? stageHeaderMatch?.[1] ?? "")
    .trim()
    .toUpperCase();
  const divisionCode = DIVISION_NAME_TO_CODE[divisionRaw];
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

  return {
    kind: "stage",
    divisionCode,
    stageNumber: stageNum,
    matchName,
    date,
    results: parseStageRows(text),
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
      .replace(/Page\s+\d+/gi, "")
      .replace(/\d{4}\s+at\s+[\d:]+/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!stripped) continue;
    if (/^%\s+Points/i.test(stripped)) continue;
    if (/^HIT\s+STAGE/i.test(stripped)) continue;
    if (/^PTS\s+TIME/i.test(stripped)) continue;
    if (/^STAGE\s+(POINTS|PERCENT)/i.test(stripped)) continue;
    if (/^COMPETITOR/i.test(stripped)) continue;
    // Filas de datos siempre arrancan con un dígito.
    if (/^\d/.test(stripped)) continue;
    candidates.push(dedupeTitle(stripped));
  }

  if (candidates.length === 0) return "";
  // El título es la línea con más sustancia — los fragmentos sueltos suelen
  // ser cortos ("Page", residuos de stripping). Empata con el primero que
  // llegó al máximo, así que en archivos overall normales sigue ganando la
  // primera ocurrencia del título.
  return candidates.reduce((a, b) => (b.length > a.length ? b : a));
}

/**
 * Algunos PDFs WinMSS extraen el título dos veces consecutivas en la
 * misma línea. Detectamos eso y deduplicamos antes de quedarnos con el
 * título limpio.
 */
function dedupeTitle(line: string): string {
  const tokens = line.split(/\s+/);
  if (tokens.length >= 2 && tokens.length % 2 === 0) {
    const half = tokens.length / 2;
    const a = tokens.slice(0, half).join(" ");
    const b = tokens.slice(half).join(" ");
    if (a === b) return a;
  }
  return line;
}

function extractDate(text: string): string {
  const m = /Printed\s+([a-záéíóúñ]+)\s+(\d{1,2}),?\s+(\d{4})/i.exec(text);
  if (!m) return "";
  const month = SPANISH_MONTHS[m[1]!.toLowerCase()];
  if (!month) return "";
  return `${m[3]}-${String(month).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

function extractStageNumber(text: string): number | null {
  const m = /Stage\s+(\d+)\s*--/i.exec(text);
  return m ? parseInt(m[1]!, 10) : null;
}

/**
 * Filas de overall: `<place> <%> <points> <bib#> <Apellido, Nombre> [meta...]`
 * Ejemplo: "1 100,00 525,0000 61 El Jaouhari, Ignacio CAN"
 */
function parseOverallRows(
  text: string,
): Array<Omit<ParsedMatchEntry, "divisionCode">> {
  const ROW_RE = /^\s*(\d+)\s+(\d+,\d+)\s+(\d+,\d+)\s+(\d+)\s+(.+?)\s*$/;
  const out: Array<Omit<ParsedMatchEntry, "divisionCode">> = [];
  for (const line of text.split(/\n/)) {
    const m = ROW_RE.exec(line);
    if (!m) continue;
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
      // Si el tirador terminó con 0 puntos, lo marcamos como DQ.
      isDq: matchPoints === 0,
    });
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
  const ROW_RE =
    /^\s*(\d+)\s+(\d+)\s+(\d+,\d+)\s+(\d+,\d+)\s+(\d+,\d+)\s+(\d+,\d+)\s+(\d+)\s+(.+?)\s*$/;
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
      isDq,
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
 * Carga `unpdf` dinámicamente (~600KB) para no inflar el bundle de
 * import/page hasta que el usuario efectivamente sube un PDF.
 */
export async function parseWinmssPdf(data: Uint8Array): Promise<ParsedMatch> {
  const { extractText } = await import("unpdf");
  const result = await extractText(data, { mergePages: false });
  return parseWinmssText(
    result.text.map((text, i) => ({ num: i + 1, text })),
  );
}
