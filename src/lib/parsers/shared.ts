import type { HTMLElement } from "node-html-parser";

/**
 * Helpers compartidos entre los parsers de PractiScore (IPSC + Steel) y FBI CSV.
 *
 * Reglas de diseño:
 *  - Solo primitivas de parseo: nada de I/O ni dependencias de DB.
 *  - Cada función tiene un comportamiento bien definido para input vacío/inválido
 *    documentado en su firma (`OrNull` vs `Or<fallback>`).
 *  - Las particularidades de cada formato (clasificación de secciones,
 *    detección de discipline) se quedan en el parser específico.
 */

// ---------------------------------------------------------------------------
// Primitivas numéricas / strings
// ---------------------------------------------------------------------------

/**
 * Devuelve el valor de la celda cuya columna se llama `key`. Si no existe,
 * devuelve `undefined` (vs string vacío) para distinguir "columna ausente"
 * de "columna presente pero vacía".
 */
export function columnValue(
  headers: string[],
  row: string[],
  key: string,
): string | undefined {
  const i = headers.findIndex((h) => h === key);
  if (i < 0) return undefined;
  return row[i]?.trim();
}

/**
 * PractiScore prefija "(DQ)" al nombre de tiradores descalificados.
 * Lo separa del nombre real y devuelve la flag `isDq`.
 */
export function stripDqPrefix(name: string): { fullName: string; isDq: boolean } {
  const m = /^\(DQ\)\s*(.+)$/.exec(name);
  if (m) return { fullName: m[1].trim(), isDq: true };
  return { fullName: name.trim(), isDq: false };
}

/**
 * Saca postfijos "ruido" del nombre tipeado para que dos variantes del mismo
 * tirador (con/sin paréntesis de cursante, con/sin tokens de región/división
 * pegados al final) generen la misma identidad en el importer y no
 * fragmenten la historia del tirador.
 *
 * Dos pasadas que se alternan hasta converger:
 *  A. Paréntesis terminales — mientras matchee `... (xxx)$`. Cubre
 *     etiquetas tipeadas por el organizador como "(Cursante)",
 *     "(Cursaste)", "(Cursando)". Cero riesgo de falso positivo: los
 *     nombres legales no llevan paréntesis al final.
 *  B. Tokens "no-nombre" al final — mientras el último token (normalizado
 *     a MAYÚSCULAS sin acentos) esté en `TRAILING_NOISE_TOKENS`. Cubre
 *     los casos donde el PDF de WinMSS o un HTML reconstruye en la misma
 *     celda la columna Region/ICS/División y el parser tradicional no la
 *     separó. Riesgo bajo pero no nulo — el set está acotado a tokens
 *     cortos en mayúsculas que es raro que formen parte de un nombre
 *     real (no incluimos letras sueltas precisamente por eso).
 *
 * El loop externo es necesario para casos como "Foo (Cursaste) ARG":
 * la primera vuelta solo B aplica (paréntesis no está al final); después
 * de que cae `ARG`, el paréntesis sí queda al final y la segunda vuelta
 * de A lo levanta.
 *
 * Pass C then drops a separator left dangling by the two above. Real case:
 * a club registered a shooter as "MONTOTO FLORES, Mini" in the minirifle
 * division, so pass B removed the trailing `MINI` and left
 * "MONTOTO FLORES," — a stored name with a comma and no given name. It
 * only ever fires on what A and B already cut, so a legitimate name
 * cannot reach it with a trailing separator of its own.
 */
export function stripNameSuffixes(name: string): string {
  let result = name;
  while (true) {
    const before = result;

    // Pasada A: paréntesis terminales.
    while (true) {
      const stripped = result.replace(/\s*\([^)]*\)\s*$/, "");
      if (stripped === result) break;
      result = stripped.trimEnd();
    }

    // Pasada B: tokens conocidos al final.
    while (true) {
      const match = /^(.+?)\s+(\S+)$/.exec(result);
      if (!match) break;
      const trailing = match[2]!
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase();
      if (!TRAILING_NOISE_TOKENS.has(trailing)) break;
      result = match[1]!.trimEnd();
    }

    // Pasada C: separador que quedó colgando tras A o B.
    result = result.replace(/[,;\-–—]+\s*$/, "").trimEnd();

    if (result === before) break;
  }
  return result;
}

/**
 * Tokens que aparecen al final del nombre cuando una columna del reporte
 * (Region/ICS/División/Disciplina) se concatenó al `Name`. Acotado a
 * tokens de ≥2 caracteres — letras sueltas son demasiado ambiguas.
 *
 * Cuando agregues uno nuevo, tené en cuenta el riesgo de que sea un
 * apellido real corto.
 */
const TRAILING_NOISE_TOKENS = new Set<string>([
  // Regiones IPSC habituales en planillas argentinas.
  "ARG", "CAN", "USA", "URU", "CHI", "BRA", "PAR", "BOL",
  // Roles ICS / organización del torneo (Oficial de Campo, Match Director,
  // Range Master, Stats, Assistant Match Director).
  "RO", "ICS", "OC", "MD", "RM", "ST", "ASM",
  // Categorías IPSC multi-letra (Super Senior, Grand Senior). Las de una
  // sola letra (S/J/L) NO las incluimos: el riesgo de pisar una inicial
  // del nombre (ej. "Diego J", "Martin S") es alto.
  "SS", "GS",
  // Marcadores de discipline/segmento que vimos colarse.
  "ESC", "1TH",
  // Códigos de división IPSC / Steel / FBI que a veces se cuelan en el
  // nombre cuando una columna del reporte queda mal alineada.
  "OPEN", "PRODUCTION", "STANDARD", "CLASSIC", "REVOLVER",
  "PCC", "PCCO", "REV", "PIS", "MINI",
  "SM", "PO", "CO", "MS", "CL",
]);

/** Parsea "85.3%" o "85.3" → 85.3. Vacío/inválido → 0. */
export function parsePercentage(value: string | undefined): number {
  if (!value) return 0;
  const n = Number(value.replace("%", "").trim());
  return Number.isFinite(n) ? n : 0;
}

/** Parsea string numérico. Vacío/inválido → `fallback`. */
export function parseFloatOr(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Parsea string numérico. Vacío/inválido → `null`. */
export function parseFloatOrNull(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Parsea entero base 10. Vacío/inválido → `fallback`. */
export function parseIntOr(value: string, fallback: number): number {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parsea entero permisivo (acepta "1.0" → 1). Vacío/inválido → `null`.
 * Usado por planillas que a veces traen el puntaje como float.
 */
export function parseIntOrNull(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Trim + null si queda vacío. Útil para campos opcionales tipo "región". */
export function nullIfEmpty(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Intenta extraer el código de club a partir del título del match.
 *
 * Convención de los reportes argentinos: el código del club aparece al
 * inicio o al final del título, en letras MAYÚSCULAS de 3 a 8 caracteres.
 * Ejemplos reales:
 *  - "TFABA 1er SOCIAL ESCOPETA" → "TFABA" (leading)
 *  - "TP ESCOPETA 20/02/26 TFALP" → "TFALP" (trailing)
 *  - "Social 4" → null (no hay token uppercase)
 *  - "Final De Curso 2026-03" → null (Final no es uppercase puro)
 *
 * No valida contra el catálogo de clubes — devuelve el candidato y el
 * importer / usuario lo confirma. Si el resultado no es un código real,
 * el botón "Editar club" del match-detail permite corregirlo.
 */
export function extractClubFromTitle(
  title: string | null | undefined,
): string | null {
  if (!title) return null;
  const trimmed = title.trim();
  if (!trimmed) return null;

  // Token uppercase al inicio: "TFABA <resto>"
  const leading = /^([A-Z][A-Z0-9]{2,7})\s/.exec(trimmed);
  if (leading) return leading[1] ?? null;

  // Token uppercase al final: "<algo> TFALP"
  const trailing = /\s([A-Z][A-Z0-9]{2,7})$/.exec(trimmed);
  if (trailing) return trailing[1] ?? null;

  return null;
}

/**
 * Devuelve el valor más frecuente entre los no-null. Útil para inferir
 * el club del match a partir del campo Club de cada tirador (caso FBI:
 * si la mayoría dice TFALP, el match probablemente se corrió ahí).
 *
 * Si la lista está vacía o todos son null, devuelve `null`.
 * En caso de empate, devuelve el primero que llegó al máximo.
 */
export function pickMostCommon<T>(
  values: ReadonlyArray<T | null | undefined>,
): T | null {
  const counts = new Map<T, number>();
  for (const v of values) {
    if (v == null) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: T | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// HTML (PractiScore)
// ---------------------------------------------------------------------------

/**
 * Busca el footer "Generated by PractiScore vX.Y.Z" y lo devuelve normalizado
 * (un único espacio entre tokens). Útil para identificar la versión del
 * generador en logs de import.
 */
export function extractGeneratedBy(root: HTMLElement): string | null {
  const div = root
    .querySelectorAll("div")
    .find((d) => /Generated by/i.test(d.textContent));
  return div ? div.textContent.replace(/\s+/g, " ").trim() : null;
}

/**
 * Extrae secciones de una tabla PractiScore particionada por
 * `<td class="division_head">`. Cada parser pasa un `classifyHead` que
 * decide qué metadata adjuntar a la sección (kind/title para IPSC,
 * divisionCode para Steel, etc.).
 *
 * Si `classifyHead` devuelve `null`, la cabecera se ignora pero la sección
 * actual sigue abierta — replicando el comportamiento previo de los dos
 * parsers que ignoraban silenciosamente cabeceras desconocidas.
 *
 * Una sección encadena el primer `<tr>` con `<th>` como headers y los
 * siguientes `<tr>` con `<td>` como rows, hasta el próximo `division_head`.
 */
export function extractDivisionalTableSections<TMeta>(
  root: HTMLElement,
  classifyHead: (titleText: string) => TMeta | null,
): Array<{ meta: TMeta; headers: string[]; rows: string[][] }> {
  const sections: Array<{ meta: TMeta; headers: string[]; rows: string[][] }> = [];
  let current: { meta: TMeta; headers: string[]; rows: string[][] } | null = null;

  for (const tr of root.querySelectorAll("tr")) {
    const headerCell = tr.querySelector("td.division_head");
    if (headerCell) {
      const titleText =
        headerCell.querySelector("b")?.textContent?.trim() ?? "";
      const meta = classifyHead(titleText);
      if (meta !== null) {
        if (current) sections.push(current);
        current = { meta, headers: [], rows: [] };
      }
      continue;
    }

    if (!current) continue;

    const ths = tr.querySelectorAll("th");
    if (ths.length > 0) {
      current.headers = ths.map((th) => th.textContent.trim());
      continue;
    }

    const tds = tr.querySelectorAll("td");
    if (tds.length > 0) {
      current.rows.push(tds.map((td) => td.textContent.trim()));
    }
  }

  if (current) sections.push(current);
  return sections;
}
