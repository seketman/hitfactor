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
 * Parsea un PDF (binario) y devuelve un ParsedMatch. Soportamos tres
 * formatos de PDF single-file: los WinMSS de ipsc.org.ar, los rankings
 * oficiales de la FAT, y los reportes de Steel Challenge generados por
 * PractiScore iPhone (Stage Results - By Division). Para Steel Challenge
 * con múltiples stages el flow correcto es `parsePdfBatch` — un único
 * PDF de Steel sirve para importar un solo stage.
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
 * cada stage viene en su propio PDF y necesitamos los 3 (o N) para
 * computar el overall del match. Para los formatos single-file (WinMSS,
 * FAT), solo aceptamos un archivo — pasar más de uno tira error.
 *
 * Detección: extraemos texto de todos los archivos, concatenamos, y
 * elegimos parser. Si el bundle es Steel → `parseSteelChallengePdfs`.
 * Si es un único archivo no-Steel → fallback a WinMSS / FAT.
 */
export async function parsePdfBatch(
  files: Array<{ data: Uint8Array; filename: string }>,
): Promise<ParsedMatch> {
  if (files.length === 0) {
    throw new Error("No se recibió ningún archivo.");
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
    throw new Error(
      "Solo Steel Challenge soporta múltiples PDFs en un mismo import. " +
        "Subí los archivos uno por uno.",
    );
  }

  // Fallback single-file: PractiScore PDF, WinMSS o FAT.
  const single = filePages[0]!;
  const singleText = single.pages.map((p) => p.text).join("\n");
  if (isPractiscorePdfFormat(singleText)) {
    return parsePractiscorePdfText(single.pages);
  }
  if (isWinmssFormat(singleText)) {
    return parseWinmssText(single.pages);
  }
  if (isFatPdfFormat(singleText)) {
    return parseFatText(singleText, single.filename);
  }
  throw new Error(
    "No reconocemos el formato de este PDF. Soportamos los PDFs de PractiScore, " +
      "los WinMSS de ipsc.org.ar, los rankings oficiales en PDF de la FAT, y los " +
      "reportes de Steel Challenge generados por PractiScore iPhone.",
  );
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
