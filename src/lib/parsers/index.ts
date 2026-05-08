import type { ParsedMatch } from "../types/match";
import { parsePractiscoreHtml } from "./practiscore";
import {
  isSteelChallengeFormat,
  parseSteelChallengeHtml,
} from "./steel-challenge";
import { isFbiCsvFormat, parseFbiCsv } from "./fbi-csv";
import { parseWinmssPdf } from "./winmss-pdf";

/**
 * Punto de entrada único para parsear cualquier reporte soportado en
 * formato texto (HTML PractiScore o CSV FBI). Para PDFs ver `parsePdf`.
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
  if (isSteelChallengeFormat(html)) {
    return parseSteelChallengeHtml(html);
  }
  return parsePractiscoreHtml(html);
}

/**
 * Parsea un PDF (binario) y devuelve un ParsedMatch. Hoy solo soportamos
 * PDFs WinMSS de ipsc.org.ar. Async porque carga `pdf-parse` dinámicamente.
 */
export async function parsePdf(data: Uint8Array): Promise<ParsedMatch> {
  return parseWinmssPdf(data);
}

export { parsePractiscoreHtml } from "./practiscore";
export { parseSteelChallengeHtml, isSteelChallengeFormat } from "./steel-challenge";
export { parseFbiCsv, isFbiCsvFormat } from "./fbi-csv";
export { parseWinmssPdf, isWinmssFormat } from "./winmss-pdf";
