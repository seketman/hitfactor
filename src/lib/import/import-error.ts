/**
 * Error de negocio del importer, identificado por código y traducido en la UI.
 *
 * Es el mismo criterio que `ParserError` (#148), aplicado acá por #203: las
 * funciones de `lib/import/` son puras respecto del locale —no tienen `t` ni
 * forma de conseguirlo sin threadear un traductor por toda la cadena— así que
 * tiran un código y la traducción ocurre en el server action, que es el primer
 * punto del camino donde hay locale.
 *
 * `ImportError` ya llevaba `code` desde el principio; lo que faltaba era
 * usarlo. Se construía con prosa en español que viajaba tal cual a la URL vía
 * `redirectImportError(e.message, ...)`, así que un usuario en `/en` recibía
 * el error en español. El mecanismo para arreglarlo estaba en el tipo, sin
 * usar.
 *
 * `message` se completa con el código —no queda vacío— para que un
 * `ImportError` que escape sin traducir siga siendo legible en los logs.
 */
export class ImportError extends Error {
  constructor(
    /** Clave bajo `import.importError` en `messages/*.json`. */
    readonly code: ImportErrorCode,
    /** Valores de interpolación del mensaje ICU, si los hay. */
    readonly params?: Record<string, string | number>,
    /**
     * Detalle técnico para el log del server. **Nunca** llega al usuario.
     *
     * Existe porque varios de estos errores envuelven un mensaje crudo de
     * Postgres. Mostrarlo era el problema de #199; perderlo del todo al
     * dejar de mostrarlo sería cambiar un bug por otro, porque es lo único
     * que explica por qué falló un insert. Va acá, se loguea en el catch.
     */
    readonly detail?: string,
  ) {
    super(`import:${code}`);
    this.name = "ImportError";
  }
}

export type ImportErrorCode =
  // Catálogo: algo del archivo no existe en la DB.
  | "UNKNOWN_DISCIPLINE"
  | "UNKNOWN_DIVISION"
  | "DIVISIONS_FETCH_FAILED"
  // Dedup: el match ya está.
  | "MATCH_ALREADY_EXISTS"
  | "MATCH_ALREADY_EXISTS_BY_OTHER"
  // Import de stages sueltos contra un match existente. Dos códigos y no
  // uno con un párrafo condicional adentro: "elegí uno de estos" y
  // "todavía no importaste ninguno de ese día" mandan al usuario a hacer
  // cosas distintas, y un ICU con un plural anidado para eso sería peor de
  // leer que dos mensajes.
  | "MATCH_NOT_FOUND"
  | "MATCH_NOT_FOUND_NONE_THAT_DAY"
  | "NOT_MATCH_OWNER"
  // Escrituras que falló la DB. Todas llevan `detail` con el mensaje crudo.
  | "MATCH_INSERT_FAILED"
  | "MATCH_ENTRIES_INSERT_FAILED"
  | "SHOOTER_INSERT_FAILED"
  | "STAGE_INSERT_FAILED"
  | "STAGE_RESULTS_INSERT_FAILED"
  // Storage: bajar los archivos que el browser subió al bucket.
  | "DOWNLOAD_FAILED"
  | "IMPORT_TOO_LARGE";
