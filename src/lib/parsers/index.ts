import type { ParsedMatch } from "../types/match";
import { parsePractiscoreHtml } from "./practiscore";
import {
  isSteelChallengeFormat,
  parseSteelChallengeHtml,
} from "./steel-challenge";

/**
 * Punto de entrada único para parsear cualquier reporte HTML soportado.
 * Detecta el formato y delega al parser correspondiente.
 */
export function parseHtml(html: string): ParsedMatch {
  if (isSteelChallengeFormat(html)) {
    return parseSteelChallengeHtml(html);
  }
  return parsePractiscoreHtml(html);
}

export { parsePractiscoreHtml } from "./practiscore";
export { parseSteelChallengeHtml, isSteelChallengeFormat } from "./steel-challenge";
