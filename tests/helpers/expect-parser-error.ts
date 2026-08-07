import { expect } from "vitest";
import { ParserError, type ParserErrorCode } from "@/lib/parsers/parser-error";

/**
 * Afirma que `fn` tira un `ParserError` con un código —y opcionalmente unos
 * params— determinados.
 *
 * Reemplaza a los `toThrow(/no pudimos leer/i)` que había antes. Asertar
 * sobre la prosa del mensaje ataba los tests al texto en español: cualquier
 * reescritura del mensaje los rompía sin que el comportamiento cambiara, y
 * desde que los mensajes viven en `messages/*.json` directamente ya no hay
 * prosa que matchear. El código es el contrato real.
 */
export function expectParserError(
  fn: () => unknown,
  code: ParserErrorCode,
  params?: Record<string, string | number>,
): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ParserError);
    const err = e as ParserError;
    expect(err.code).toBe(code);
    if (params) expect(err.params).toMatchObject(params);
    return;
  }
  throw new Error(`Se esperaba un ParserError "${code}", pero no tiró nada.`);
}
