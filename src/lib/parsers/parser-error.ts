/**
 * Error de parseo con un código traducible en vez de prosa en español.
 *
 * **Por qué código y no un traductor inyectado.** Los parsers son funciones
 * puras y profundas: `parsePdfBatch` → `parseWinmssText` → helpers internos.
 * Pasarles un `t` obligaría a threadearlo por toda esa cadena, y encima
 * acoplaría el parser —que se testea con fixtures y sin nada de i18n— al
 * paquete de traducción.
 *
 * **Por qué NO viaja el código hasta el browser.** Los errores de subida
 * (`UploadErrorCode`) sí lo hacen, porque ocurren en el cliente y ahí no hay
 * traductor de servidor. Estos son distintos: se tiran y se atrapan del lado
 * del servidor, dentro del server action, donde `getTranslations` está
 * disponible. Se traducen ahí y sigue viajando texto ya resuelto, sin tocar
 * el contrato del querystring de `/import`.
 *
 * `message` se completa con el código para que un `ParserError` que escape
 * sin traducir siga siendo legible en los logs.
 */
export class ParserError extends Error {
  constructor(
    /** Clave bajo `import.parserError` en `messages/*.json`. */
    readonly code: ParserErrorCode,
    /** Valores de interpolación del mensaje ICU, si los hay. */
    readonly params?: Record<string, string | number>,
  ) {
    super(`parser:${code}`);
    this.name = "ParserError";
  }
}

export type ParserErrorCode =
  // Entrada vacía o ausente
  | "noFiles"
  | "emptyPdf"
  // Formato no reconocido
  | "unknownPdfFormat"
  | "missingHeaderRow"
  | "missingHeader"
  // El formato se reconoció, pero el modo de subida no se soporta
  | "multiplePdfsUnsupported"
  // Metadata que no se pudo extraer
  | "noWinmssMatchName"
  | "noPractiscoreMatchName"
  | "noPrintedDate"
  | "noIsoTitleDate"
  | "noSteelDate"
  | "fatUnknownDiscipline"
  // El formato se reconoció pero no se sacaron filas
  | "winmssNoRows"
  | "practiscoreNoRows"
  | "fatNoSections"
  | "fatNoDivisions"
  | "steelCategoryLeadersOnly"
  // Numeración de stages inconsistente
  | "duplicateStageNumber"
  | "duplicateStageFile"
  | "stageSlotTaken"
  // Import parcial detectado
  | "partialRows";
