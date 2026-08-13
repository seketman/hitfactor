import {
  DISCIPLINE,
  isHitsBasedDiscipline,
  type DisciplineCode,
} from "../disciplines";
import type { ParsedMatch, ParsedMatchEntry } from "../types/match";
import { resolveDivisionCode } from "./division-registry";
import { stripNameSuffixes } from "./shared";
import { ParserError } from "./parser-error";
import { isValidIsoDate } from "../dates";

/**
 * Parser para los PDFs de "RANKING OFICIAL" que publica la FAT (Federación
 * Argentina de Tiro).
 *
 * Es un formato deliberadamente pobre: solo el ranking general del match,
 * sin stages, sin clubes y sin fecha. Cada sección es un ranking ya
 * ordenado ("1. NOMBRE   impactos / puntos"). La disciplina NO aparece en
 * el cuerpo del PDF — viene en el nombre del archivo (ej.:
 * "resultados-apertura-fbi.pdf").
 *
 * Estructura típica del PDF:
 *
 *   RANKING OFICIAL
 *   PISTOLA GENERAL
 *   1. MARTIN SALADINO        40 / 196
 *   2. GUSTAVO CASTAGNETO     40 / 186
 *   ...
 *   REVOLVER GENERAL
 *   1. GASTON ACETO           39 / 178
 *   ...
 *   PISTOLA VETERANO          <- subranking: mismos tiradores, filtrados
 *   1. GUSTAVO CASTAGNETO     40 / 186
 *   ...
 *   DAMAS                     <- subranking sin división explícita
 *   1. ABRIL SARALEGUI        35 / 138
 *
 * Cada header de sección es "<DIVISIÓN> <CATEGORÍA>". La categoría
 * "GENERAL" es el ranking completo de la división — de ahí salen los
 * match_entries. Las demás (VETERANO, DAMAS, CADETE...) son subrankings:
 * solo se usan para etiquetar la `category` del tirador, NO generan entries
 * nuevos (el mismo tirador no puede entrar dos veces en la misma división;
 * lo prohíbe el UNIQUE (match, shooter, division) de la DB).
 *
 * Diseño:
 *  - `parseFatText(text, filename)`: pure function. Los tests le pasan
 *    texto + nombre de archivo sin necesitar un PDF real.
 *  - La extracción de texto del binario la hace `parsePdf` (ver index.ts),
 *    compartida con el parser WinMSS.
 *
 * Alcance: el único formato validado contra un archivo real es el de Tiro
 * FBI (secciones PISTOLA / REVOLVER). El layout lo usa la FAT para varias
 * disciplinas; las demás se intentan mapear best-effort y, si no se puede,
 * el import se rechaza con un mensaje claro en vez de importar algo a medias.
 */

/**
 * Una fila de ranking: "1. NOMBRE  impactos / puntos". Toleramos que el
 * punto del puesto venga pegado o separado, y que la barra del "x / y"
 * tenga o no espacios alrededor (depende de cómo unpdf reconstruya).
 */
const ROW_RE = /^(\d{1,3})\s*[.)]?\s+(.+?)\s+(\d{1,4})\s*\/\s*(\d{1,5})$/;

/**
 * Palabras clave que mapean el nombre del archivo a una de las 4
 * disciplinas de la app. Si el nombre no matchea exactamente una, el
 * import se rechaza (no intentamos adivinar).
 */
const FILENAME_DISCIPLINE: Array<{ keyword: RegExp; discipline: DisciplineCode }> =
  [
    { keyword: /\bfbi\b/, discipline: DISCIPLINE.FBI },
    { keyword: /\bipsc\b/, discipline: DISCIPLINE.IPSC },
    { keyword: /\b(steel|steelchallenge)\b/, discipline: DISCIPLINE.STEEL },
    { keyword: /\bcombat\b/, discipline: DISCIPLINE.COMBAT },
  ];

// El mapeo nombre-de-división → `code` por disciplina vive en el registry
// compartido (`division-registry.ts`). Solo el set de Tiro FBI está verificado
// contra un PDF real; los demás son best-effort (si un header no matchea, la
// sección se ignora).

/** Palabras de ruido a sacar al derivar el nombre del match del filename. */
const FILENAME_NOISE = /\b(resultados?|ranking|oficial|fat)\b/gi;

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Heurística de detección. Un PDF es un ranking de la FAT si tiene el
 * título "RANKING OFICIAL" y al menos unas pocas filas con el formato
 * "N. NOMBRE  x / y". Los dos juntos descartan cualquier otro PDF sin
 * riesgo de falso positivo.
 */
export function isFatPdfFormat(text: string): boolean {
  if (!/RANKING\s+OFICIAL/i.test(text)) return false;
  let rows = 0;
  for (const line of text.split(/\r?\n/)) {
    if (ROW_RE.test(line.trim())) {
      rows++;
      if (rows >= 3) return true;
    }
  }
  return false;
}

/**
 * Determina la disciplina a partir del nombre del archivo. Devuelve `null`
 * si no matchea exactamente una de las 4 disciplinas conocidas (ni 0 ni 2+).
 */
export function detectDisciplineFromFilename(
  filename: string,
): DisciplineCode | null {
  const normalized = ` ${filename
    .replace(/\.[^.]*$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
  const matches = FILENAME_DISCIPLINE.filter((d) => d.keyword.test(normalized));
  return matches.length === 1 ? matches[0]!.discipline : null;
}

/**
 * Parsea el texto plano de un PDF de la FAT (todas las páginas concatenadas)
 * y devuelve el `ParsedMatch`. Necesita el `filename` porque de ahí salen
 * la disciplina y el nombre del torneo.
 */
export function parseFatText(text: string, filename: string): ParsedMatch {
  const discipline = detectDisciplineFromFilename(filename);
  if (!discipline) {
    throw new ParserError("fatUnknownDiscipline", { filename });
  }

  const sections = parseSections(text, discipline);
  if (sections.length === 0) {
    throw new ParserError("fatNoSections");
  }

  // Mapa nombre→categoría: lo arman las secciones que NO son "GENERAL"
  // (VETERANO, DAMAS, CADETE...). La primera que aparece para un tirador
  // gana — un tirador rara vez está en dos categorías a la vez.
  const categoryByName = new Map<string, string>();
  for (const section of sections) {
    if (!section.meta.category) continue;
    for (const row of section.rows) {
      const key = accentFoldedName(row.name);
      if (!categoryByName.has(key)) {
        categoryByName.set(key, section.meta.category);
      }
    }
  }

  // Por cada división elegimos como ranking canónico la sección con más
  // filas: la "GENERAL" es siempre el superconjunto. Las otras secciones
  // de esa división ya aportaron su categoría arriba y se descartan acá
  // (si no, el mismo tirador entraría dos veces en la división).
  const rankingByDivision = new Map<string, Section>();
  for (const section of sections) {
    const code = section.meta.divisionCode;
    if (!code) continue;
    const prev = rankingByDivision.get(code);
    if (!prev || section.rows.length > prev.rows.length) {
      rankingByDivision.set(code, section);
    }
  }

  if (rankingByDivision.size === 0) {
    const found = sections.map((s) => s.header).join(", ");
    throw new ParserError("fatNoDivisions", { sections: found });
  }

  const hitsBased = isHitsBasedDiscipline(discipline);
  const matchEntries: ParsedMatchEntry[] = [];
  for (const [divisionCode, section] of rankingByDivision) {
    // El PDF ya viene rankeado: la primera fila es el ganador.
    const winnerPoints = section.rows[0]?.points ?? 0;
    for (const row of section.rows) {
      const matchPercentage =
        winnerPoints > 0 ? (row.points / winnerPoints) * 100 : 0;
      matchEntries.push({
        shooter: {
          fullName: stripNameSuffixes(row.name),
          memberNumber: null,
          region: null,
        },
        divisionCode,
        classification: null,
        powerFactor: null,
        category: categoryByName.get(accentFoldedName(row.name)) ?? null,
        place: row.rank,
        matchPoints: row.points,
        matchPercentage,
        totalTimeSeconds: null,
        // El primer número del "x / y" son impactos: solo aplica a las
        // disciplinas que rankean por impactos (Tiro FBI).
        hits: hitsBased ? row.hits : null,
        isDq: false,
        // FAT no marca DQs en el ranking, así que 0 puntos + 0% es ausente.
        // Para hits-based (Tiro FBI), exigimos también 0 impactos.
        isAbsent:
          row.points === 0 &&
          matchPercentage === 0 &&
          (hitsBased ? row.hits === 0 : true),
      });
    }
  }

  return {
    discipline,
    source: "fat_pdf",
    name: matchNameFromFilename(filename),
    // La FAT no incluye la fecha; se intenta sacar del nombre del archivo
    // y, si no está, queda vacía: el flujo de import se la pide al usuario.
    date: dateFromFilename(filename) ?? "",
    region: null,
    matchEntries,
    stages: [],
    generatedBy: "FAT",
  };
}

// ---------------------------------------------------------------------------
// Secciones
// ---------------------------------------------------------------------------

interface RawRow {
  rank: number;
  name: string;
  hits: number;
  points: number;
}

interface SectionMeta {
  /** Código de división, o null si la sección no nombra una (ej. "DAMAS"). */
  divisionCode: string | null;
  /** Categoría legible para `match_entries.category`; null para "GENERAL". */
  category: string | null;
}

interface Section {
  header: string;
  meta: SectionMeta;
  rows: RawRow[];
}

/**
 * Parte el texto en secciones. Una sección es un header seguido de filas.
 * Las secciones pueden cruzar saltos de página: el header de cada una es
 * la última línea que NO es fila antes de que empiecen las filas (así un
 * título suelto o un encabezado de página repetido no abre una sección
 * espuria).
 */
function parseSections(text: string, discipline: DisciplineCode): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  let pendingHeader: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const rowMatch = ROW_RE.exec(line);
    if (rowMatch) {
      if (pendingHeader !== null) {
        current = {
          header: pendingHeader,
          meta: classifyHeader(pendingHeader, discipline),
          rows: [],
        };
        sections.push(current);
        pendingHeader = null;
      }
      // Fila sin header previo: PDF mal formado, la ignoramos.
      if (!current) continue;
      current.rows.push({
        rank: Number(rowMatch[1]),
        name: rowMatch[2]!.trim(),
        hits: Number(rowMatch[3]),
        points: Number(rowMatch[4]),
      });
      continue;
    }

    // Línea que no es fila: candidata a header. Nos quedamos con la última
    // antes de que empiecen las filas.
    if (isIgnorableLine(line)) continue;
    pendingHeader = line;
  }

  return sections.filter((s) => s.rows.length > 0);
}

/** Líneas que nunca son un header de sección (título, números de página). */
function isIgnorableLine(line: string): boolean {
  const norm = line
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
  if (/^RANKING\s+OFICIAL$/.test(norm)) return true;
  if (/^PAGINA\b/.test(norm)) return true;
  if (/^\d+$/.test(norm)) return true;
  return false;
}

/**
 * Clasifica un header de sección en (división, categoría). El header es
 * "<DIVISIÓN> <CATEGORÍA>"; la división puede faltar (secciones como
 * "DAMAS" o "CADETE MAYOR" que no nombran un arma).
 */
function classifyHeader(
  header: string,
  discipline: DisciplineCode,
): SectionMeta {
  const norm = header
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
  const tokens = norm.split(" ");

  // Longest-prefix match: "PRODUCTION OPTICS GENERAL" → división
  // "PRODUCTION OPTICS", categoría "GENERAL".
  for (let take = Math.min(tokens.length, 3); take >= 1; take--) {
    const candidate = tokens.slice(0, take).join(" ");
    const code = resolveDivisionCode(discipline, candidate);
    if (code) {
      return {
        divisionCode: code,
        category: categoryLabel(tokens.slice(take).join(" ")),
      };
    }
  }
  // Sin división reconocida: categoría-only (DAMAS, CADETE MAYOR...).
  return { divisionCode: null, category: categoryLabel(norm) };
}

/** "GENERAL" / vacío → sin categoría. El resto se title-casea para mostrar. */
function categoryLabel(raw: string): string | null {
  const norm = raw.trim();
  if (!norm || norm === "GENERAL") return null;
  return titleCase(norm);
}

// ---------------------------------------------------------------------------
// Nombre y fecha (del filename)
// ---------------------------------------------------------------------------

/**
 * Deriva el nombre del torneo del nombre del archivo: saca la extensión,
 * la palabra de disciplina, las palabras de ruido ("resultados", "ranking"...)
 * y los tokens numéricos de fecha, y title-casea lo que queda.
 *
 * "resultados-apertura-fbi.pdf" → "Apertura".
 */
function matchNameFromFilename(filename: string): string {
  const base = filename
    .replace(/\.[^.]*$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b(fbi|ipsc|steel|steelchallenge|combat)\b/gi, " ")
    .replace(FILENAME_NOISE, " ")
    .replace(/\b\d{2,4}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!base) return "Match FAT";
  return titleCase(base);
}

/**
 * Intenta extraer una fecha del nombre del archivo. Acepta YYYY-MM-DD y
 * DD-MM-YYYY (con o sin separadores). Devuelve ISO o `null` si no hay /
 * no es válida.
 */
function dateFromFilename(filename: string): string | null {
  const base = filename.replace(/\.[^.]*$/, "");

  const ymd = /(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/.exec(base);
  if (ymd) {
    const iso = `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
    if (isValidIsoDate(iso)) return iso;
  }

  const dmy = /\b(\d{2})[-_.](\d{2})[-_.](20\d{2}|\d{2})\b/.exec(base);
  if (dmy) {
    const year = dmy[3]!.length === 2 ? `20${dmy[3]}` : dmy[3]!;
    const iso = `${year}-${dmy[2]}-${dmy[1]}`;
    if (isValidIsoDate(iso)) return iso;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers de strings
// ---------------------------------------------------------------------------

/**
 * Key for matching one competitor against themselves across sections of a
 * single FAT PDF: accents folded (ñ→n included), UPPER, whitespace collapsed.
 *
 * Folding is safe *here* because these PDFs spell the same competitor both
 * ways within one document — "GUSTAVO CASTAGNETO" and "GUSTAVO CASTAGÑETO" are
 * the same row of the same ranking.
 *
 * **It is safe only here.** This repo has three name keys and they must not be
 * aligned; `lib/names.ts` is the single place that compares them and says why.
 * Read it before reusing this one.
 *
 * Exported so `tests/name-normalization.test.ts` can pin the difference. That
 * test also fails if anything else imports it.
 */
export function accentFoldedName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value: string): string {
  return value.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
