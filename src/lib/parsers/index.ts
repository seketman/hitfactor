import type { ParsedMatch } from "../types/match";
import { parsePractiscoreHtml } from "./practiscore";
import {
  isSteelChallengeFormat,
  parseSteelChallengeHtml,
} from "./steel-challenge";
import {
  isSteelChallengePdfFormat,
  parseSteelChallengePdfs,
  type SteelPdfFile,
} from "./steel-challenge-pdf";
import { isFbiCsvFormat, parseFbiCsv } from "./fbi-csv";
import { extractPdfPages } from "./pdf-extract";
import { isWinmssFormat, parseWinmssText } from "./winmss-pdf";
import {
  isPractiscorePdfFormat,
  parsePractiscorePdfText,
} from "./practiscore-pdf";
import { isFatPdfFormat, parseFatText } from "./fat-pdf";
import { ParserError } from "./parser-error";

/**
 * Selección de parser por **registry de descriptores** en lugar de un
 * if-ladder hardcoded (issue #119). Cada formato declara `{ detect, parse }`
 * y se agrega empujando una entrada a la lista — el dispatcher queda cerrado
 * a modificación (OCP). El orden importa: el primero cuyo `detect` da true
 * gana, así que las heurísticas más específicas van primero.
 */

/** Descriptor de un formato basado en texto (HTML / CSV). */
interface TextFormat {
  detect: (content: string) => boolean;
  parse: (content: string) => ParsedMatch;
}

/**
 * Formatos HTML. PractiScore IPSC es el default (no tiene `detect` propio:
 * es el catch-all histórico cuando el HTML no es Steel).
 */
const HTML_FORMATS: TextFormat[] = [
  { detect: isSteelChallengeFormat, parse: parseSteelChallengeHtml },
];

/**
 * Punto de entrada único para reportes en texto (HTML PractiScore o CSV FBI).
 * Para PDFs ver `parsePdf`.
 */
export function parseFile(content: string): ParsedMatch {
  if (isFbiCsvFormat(content)) {
    return parseFbiCsv(content);
  }
  return parseHtml(content);
}

/**
 * Variante explícita para reportes HTML (PractiScore IPSC / Steel Challenge).
 * Mantenida porque varios tests la usan directamente.
 */
export function parseHtml(html: string): ParsedMatch {
  for (const fmt of HTML_FORMATS) {
    if (fmt.detect(html)) return fmt.parse(html);
  }
  return parsePractiscoreHtml(html);
}

/** Una página extraída + el nombre del archivo de origen. */
type SingleFile = SteelPdfFile;

/** Descriptor de un formato PDF single-file (WinMSS / FAT / PractiScore). */
interface SingleFilePdfFormat {
  detect: (text: string) => boolean;
  parse: (file: SingleFile) => ParsedMatch;
}

/**
 * Formatos PDF single-file. Steel Challenge NO está acá: es multi-archivo y
 * se maneja aparte (se suben N stages juntos).
 */
const SINGLE_FILE_PDF_FORMATS: SingleFilePdfFormat[] = [
  {
    detect: isPractiscorePdfFormat,
    parse: (f) => parsePractiscorePdfText(f.pages),
  },
  { detect: isWinmssFormat, parse: (f) => parseWinmssText(f.pages) },
  {
    detect: isFatPdfFormat,
    parse: (f) => parseFatText(f.pages.map((p) => p.text).join("\n"), f.filename),
  },
];

/**
 * Parsea un PDF (binario) y devuelve un ParsedMatch. Soporta los formatos
 * single-file (WinMSS, FAT, PractiScore PDF). Para Steel Challenge con
 * múltiples stages el flow correcto es `parsePdfBatch`.
 *
 * Async porque carga `unpdf` dinámicamente.
 */
export async function parsePdf(
  data: Uint8Array,
  filename: string,
): Promise<ParsedMatch> {
  return parsePdfBatch([{ data, filename }]);
}

/**
 * Versión multi-archivo de `parsePdf`. Pensada para Steel Challenge donde
 * cada stage viene en su propio PDF y necesitamos los N para computar el
 * overall. Para los formatos single-file solo aceptamos un archivo.
 *
 * Detección: extraemos texto de todos los archivos, concatenamos, y elegimos
 * parser. Steel (multi-file) se chequea primero; si no, se itera el registry
 * de formatos single-file.
 */
export async function parsePdfBatch(
  files: Array<{ data: Uint8Array; filename: string }>,
): Promise<ParsedMatch> {
  if (files.length === 0) {
    throw new ParserError("noFiles");
  }

  const filePages: SteelPdfFile[] = await Promise.all(
    files.map(async (f) => ({
      pages: await extractPdfPages(f.data),
      filename: f.filename,
    })),
  );
  const fullText = filePages
    .flatMap((f) => f.pages.map((p) => p.text))
    .join("\n");

  if (isSteelChallengePdfFormat(fullText)) {
    return parseSteelChallengePdfs(filePages);
  }

  if (files.length > 1) {
    throw new ParserError("multiplePdfsUnsupported");
  }

  const single = filePages[0]!;
  const singleText = single.pages.map((p) => p.text).join("\n");
  for (const fmt of SINGLE_FILE_PDF_FORMATS) {
    if (fmt.detect(singleText)) return fmt.parse(single);
  }
  throw new ParserError("unknownPdfFormat");
}

export { parsePractiscoreHtml } from "./practiscore";
export { parseSteelChallengeHtml, isSteelChallengeFormat } from "./steel-challenge";
export {
  parseSteelChallengePdfs,
  isSteelChallengePdfFormat,
  type SteelPdfFile,
} from "./steel-challenge-pdf";
export { parseFbiCsv, isFbiCsvFormat } from "./fbi-csv";
export { parseWinmssText, isWinmssFormat } from "./winmss-pdf";
export {
  parsePractiscorePdfText,
  isPractiscorePdfFormat,
  type PractiscorePdfPage,
} from "./practiscore-pdf";
export { parseFatText, isFatPdfFormat } from "./fat-pdf";
