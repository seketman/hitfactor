import type { ParsedMatch } from "../types/match";
import { parsePractiscoreHtml } from "./practiscore";
import {
  isSteelChallengeFormat,
  parseSteelChallengeHtml,
} from "./steel-challenge";
import { isFbiCsvFormat, parseFbiCsv } from "./fbi-csv";
import { extractPdfPages } from "./pdf-extract";
import { isWinmssFormat, parseWinmssText } from "./winmss-pdf";
import { isFatPdfFormat, parseFatText } from "./fat-pdf";

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
 * Parsea un PDF (binario) y devuelve un ParsedMatch. Soportamos dos
 * formatos de PDF: los WinMSS de ipsc.org.ar y los rankings oficiales de
 * la FAT. Extraemos el texto una vez y elegimos el parser según el
 * contenido; el `filename` lo necesita el parser de la FAT (de ahí saca
 * la disciplina y el nombre del torneo).
 *
 * Async porque carga `unpdf` dinámicamente.
 */
export async function parsePdf(
  data: Uint8Array,
  filename: string,
): Promise<ParsedMatch> {
  const pages = await extractPdfPages(data);
  const fullText = pages.map((p) => p.text).join("\n");

  if (isWinmssFormat(fullText)) {
    return parseWinmssText(pages);
  }
  if (isFatPdfFormat(fullText)) {
    return parseFatText(fullText, filename);
  }
  throw new Error(
    "No reconocemos el formato de este PDF. Soportamos los PDFs WinMSS de " +
      "ipsc.org.ar y los rankings oficiales en PDF de la FAT.",
  );
}

export { parsePractiscoreHtml } from "./practiscore";
export { parseSteelChallengeHtml, isSteelChallengeFormat } from "./steel-challenge";
export { parseFbiCsv, isFbiCsvFormat } from "./fbi-csv";
export { parseWinmssText, isWinmssFormat } from "./winmss-pdf";
export { parseFatText, isFatPdfFormat } from "./fat-pdf";
