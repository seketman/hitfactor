import type { ParsedMatch } from "../types/match";
import { parsePractiscoreHtml } from "./practiscore";
import {
  isSteelChallengeFormat,
  parseSteelChallengeHtml,
} from "./steel-challenge";
import { isFbiCsvFormat, parseFbiCsv } from "./fbi-csv";

/**
 * Punto de entrada único para parsear cualquier reporte soportado.
 * Detecta el formato (HTML PractiScore vs CSV FBI) y delega al parser correcto.
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

export { parsePractiscoreHtml } from "./practiscore";
export { parseSteelChallengeHtml, isSteelChallengeFormat } from "./steel-challenge";
export { parseFbiCsv, isFbiCsvFormat } from "./fbi-csv";
