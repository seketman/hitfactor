import { ImportError } from "./import-error";

/**
 * Traduce un `divisions.code` al id de la DB, o corta el import.
 *
 * El mensaje nombra el valor tal como llegó porque casi siempre no es un
 * code de la DB sino lo que el parser no supo mapear. En los HTML de
 * PractiScore, por ejemplo, cuando el título de la sección no está en el
 * registry el parser cae a la columna `Div`, que el organizador configura
 * a mano — de ahí salen valores como "PP" o "C" que no existen en
 * `divisions`. El arreglo es agregar el alias del **título de la sección**
 * en `division-registry.ts`, no crear una división nueva.
 */
export function requireDivision(
  divisionByCode: Map<string, number>,
  code: string,
): number {
  const id = divisionByCode.get(code);
  if (!id) {
    throw new ImportError("UNKNOWN_DIVISION", { code });
  }
  return id;
}
