import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import es from "../messages/es.json";
import en from "../messages/en.json";

/**
 * Guardas contra desincronización de los mensajes.
 *
 * Los dos fallos que cubre son silenciosos: una clave que existe en un idioma
 * y no en el otro se renderiza como `namespace.clave` en la UI, y un código de
 * error sin mensaje hace lo mismo. Ninguno rompe el build ni tira.
 *
 * Es el mismo criterio que `migrations-doc.test.ts`: si algo tiene que
 * mantenerse en sincronía a mano, hay un test que lo verifica.
 */

function flatten(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) =>
    flatten(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe("messages es/en", () => {
  it("tienen exactamente las mismas claves", () => {
    const keysEs = flatten(es).sort();
    const keysEn = flatten(en).sort();
    expect(keysEs.filter((k) => !keysEn.includes(k))).toEqual([]);
    expect(keysEn.filter((k) => !keysEs.includes(k))).toEqual([]);
  });

  // Un `{name}` que en un idioma se escribió `{nombre}` compila, pasa el
  // typecheck, y en runtime renderiza el placeholder crudo.
  it("usan los mismos placeholders en cada clave", () => {
    // Un placeholder es `{nombre}` o `{nombre, plural, ...}`: después del nombre
    // viene una coma o la llave de cierre. El `\s*[,}]` no es opcional — sin
    // él, el texto de las ramas de un plural ICU (`{sobre # torneo}`) matchea
    // como si fuera un placeholder, y como ese texto está traducido, cada
    // mensaje con plural daría un falso positivo.
    const placeholders = (v: unknown) =>
      typeof v === "string"
        ? [...v.matchAll(/\{(\w+)\s*[,}]/g)].map((m) => m[1]!).sort()
        : [];
    const walk = (a: unknown, b: unknown, path: string): void => {
      if (typeof a === "string" || typeof b === "string") {
        expect(
          { [path]: placeholders(a) },
          `placeholders distintos en ${path}`,
        ).toEqual({ [path]: placeholders(b) });
        return;
      }
      if (typeof a !== "object" || a === null) return;
      for (const k of Object.keys(a)) {
        walk(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)?.[k],
          path ? `${path}.${k}` : k,
        );
      }
    };
    walk(es, en, "");
  });
});

/**
 * Los códigos de `ParserErrorCode` son la única fuente de verdad de qué
 * errores puede tirar un parser. Se leen del archivo en vez de importarlos
 * porque son un tipo, no un valor: no existen en runtime.
 */
describe("ParserErrorCode ↔ messages", () => {
  const source = readFileSync("src/lib/parsers/parser-error.ts", "utf8");
  const union = source.slice(source.indexOf("export type ParserErrorCode"));
  const codes = [...union.matchAll(/\|\s*"(\w+)"/g)].map((m) => m[1]!);

  it("encuentra los códigos declarados", () => {
    expect(codes.length).toBeGreaterThan(10);
  });

  it.each(["es", "en"])("cada código tiene mensaje en %s", (locale) => {
    const messages = (locale === "es" ? es : en).import.parserError as Record<
      string,
      string
    >;
    expect(codes.filter((c) => !(c in messages))).toEqual([]);
  });

  it("no hay mensajes de error sin código que los use", () => {
    const declared = Object.keys(es.import.parserError);
    expect(declared.filter((k) => !codes.includes(k))).toEqual([]);
  });
});

/**
 * Los `params` que pasa cada `new ParserError(...)` tienen que coincidir con
 * los placeholders del mensaje.
 *
 * Es un desalineamiento silencioso: pasar `{ stageNumber }` a un mensaje que
 * dice `{stage}` no rompe nada — ICU renderiza `{stage}` crudo en la pantalla
 * de error, justo cuando el usuario más necesita entender qué pasó. El
 * typecheck no lo ve porque `params` es un `Record<string, ...>` abierto.
 */
describe("ParserError: params ↔ placeholders", () => {
  const sources = [
    "index",
    "winmss-pdf",
    "practiscore-pdf",
    "fbi-csv",
    "steel-challenge-pdf",
    "fat-pdf",
  ]
    .map((f) => readFileSync(`src/lib/parsers/${f}.ts`, "utf8"))
    .join("\n");

  const calls = [
    ...sources.matchAll(/new ParserError\(\s*"(\w+)"\s*(?:,\s*\{([^}]*)\})?/g),
  ].map(([, code, params]) => ({
    code: code!,
    params: (params ?? "")
      .split(",")
      .map((p) => p.split(":")[0]!.trim())
      .filter(Boolean)
      .sort(),
  }));

  it("encuentra los throws de los parsers", () => {
    expect(calls.length).toBeGreaterThan(15);
  });

  it.each(calls.map((c) => [c.code, c.params] as const))(
    "%s pasa exactamente los params que su mensaje usa",
    (code, params) => {
      const message = (es.import.parserError as Record<string, string>)[code];
      expect(message, `falta el mensaje de "${code}"`).toBeDefined();
      const placeholders = [...message!.matchAll(/\{(\w+)\s*[,}]/g)]
        .map((m) => m[1]!)
        .sort();
      expect(params).toEqual(placeholders);
    },
  );
});
