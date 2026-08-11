import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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

/**
 * Nombres de los argumentos ICU de un mensaje: los `{name}` y los
 * `{name, plural|select, ...}`, **sin** los cuerpos de sus ramas.
 *
 * Se camina la estructura en vez de aplicar un regex. El que había antes
 * (`/\{(\w+)\s*[,}]/`) confundía la rama de un `select` con un argumento: en
 * `{type, select, suggestion {Implementada} other {Resuelto}}` levantaba
 * `type`, `Implementada` y `Resuelto`, y como esas dos últimas están
 * traducidas, todo mensaje con `select` daba un falso positivo.
 *
 * Los plurales que ya existían se salvaban de casualidad, porque sus ramas
 * empiezan con `#` y `#` no es `\w`. Una rama de una sola palabra no tiene
 * esa suerte, y es lo que destapó `about.statusDone` al usar `select` para
 * que "resuelto" y "implementada" sean decisión de cada idioma.
 */
function icuArguments(message: string): string[] {
  const names: string[] = [];
  let i = 0;

  const skipSpace = () => {
    while (i < message.length && /\s/.test(message[i]!)) i++;
  };

  /** Recorre texto hasta el `}` que lo cierra (o el final). */
  const parseMessage = (): void => {
    while (i < message.length) {
      if (message[i] === "}") return;
      if (message[i] !== "{") {
        i++;
        continue;
      }
      parseArgument();
    }
  };

  const parseArgument = (): void => {
    i++; // "{"
    skipSpace();
    let name = "";
    while (i < message.length && /[\w.]/.test(message[i]!)) name += message[i++]!;
    if (name) names.push(name);
    skipSpace();

    if (message[i] === "}") {
      i++;
      return;
    }
    if (message[i] !== ",") return; // malformado: no se inventa nada
    i++;
    skipSpace();

    let type = "";
    while (i < message.length && /\w/.test(message[i]!)) type += message[i++]!;
    skipSpace();

    if (type === "plural" || type === "select" || type === "selectordinal") {
      if (message[i] === ",") i++;
      while (i < message.length) {
        skipSpace();
        if (message[i] === "}") {
          i++;
          return;
        }
        // El selector (`one`, `other`, `=0`, `bug`) NO es un argumento.
        while (i < message.length && !/[\s{}]/.test(message[i]!)) i++;
        skipSpace();
        if (message[i] !== "{") continue;
        i++;
        parseMessage(); // una rama puede anidar argumentos de verdad
        if (message[i] === "}") i++;
      }
      return;
    }

    // number/date/time y cualquier otro: saltar hasta cerrar.
    let depth = 1;
    while (i < message.length && depth > 0) {
      if (message[i] === "{") depth++;
      else if (message[i] === "}") depth--;
      i++;
    }
  };

  parseMessage();
  return names;
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
    const placeholders = (v: unknown) =>
      typeof v === "string" ? icuArguments(v).sort() : [];
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

/**
 * Lo mismo para `ImportErrorCode`, que hasta #203 no lo necesitaba: los
 * `ImportError` se construían con prosa española hardcodeada, así que no
 * había mensajes con los que desincronizarse. Ahora sí, y con el mismo
 * modo de falla silencioso — un código sin mensaje se renderiza como
 * `import.importError.LO_QUE_SEA` en la pantalla de error.
 */
describe("ImportErrorCode ↔ messages", () => {
  const source = readFileSync("src/lib/import/import-error.ts", "utf8");
  const union = source.slice(source.indexOf("export type ImportErrorCode"));
  const codes = [...union.matchAll(/\|\s*"(\w+)"/g)].map((m) => m[1]!);

  it("encuentra los códigos declarados", () => {
    expect(codes.length).toBeGreaterThan(10);
  });

  it.each(["es", "en"])("cada código tiene mensaje en %s", (locale) => {
    const messages = (locale === "es" ? es : en).import.importError as Record<
      string,
      string
    >;
    expect(codes.filter((c) => !(c in messages))).toEqual([]);
  });

  it("no hay mensajes de error sin código que los use", () => {
    const declared = Object.keys(es.import.importError);
    expect(declared.filter((k) => !codes.includes(k))).toEqual([]);
  });
});

/**
 * Y el chequeo de params ↔ placeholders, por la misma razón que en
 * `ParserError`: pasar `{ file }` a un mensaje que dice `{filename}` no
 * rompe nada, solo imprime `{filename}` crudo en la pantalla de error.
 *
 * Se escanean todos los módulos de `lib/import/` que tiran, no una lista
 * fija: un archivo nuevo que empiece a tirar `ImportError` entra solo.
 */
describe("ImportError: params ↔ placeholders", () => {
  const dir = "src/lib/import";
  /**
   * Se sacan los comentarios antes de escanear. Sin esto el regex matchea
   * la prosa que documenta el propio guardrail: el comentario de
   * `import-match.ts` que explica por qué los códigos van literales
   * contiene `new ImportError("CODE", ...)` como ejemplo, y el test lo
   * levantaba como un throw real y fallaba pidiendo el mensaje de "CODE".
   * Mismo tropiezo que tuvo `no-host-header-urls.test.ts` con su propia
   * explicación.
   */
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("el stripper de comentarios no vació el fuente (sanity check)", () => {
    // Un stripper roto dejaría 0 throws y todo lo de abajo pasaría en vacío.
    expect(sources).toContain("new ImportError(");
    expect(sources.length).toBeGreaterThan(5000);
  });

  const calls = [
    ...sources.matchAll(/new ImportError\(\s*"(\w+)"\s*(?:,\s*\{([^}]*)\})?/g),
  ].map(([, code, params]) => ({
    code: code!,
    params: (params ?? "")
      .split(",")
      .map((p) => p.split(":")[0]!.trim())
      .filter(Boolean)
      .sort(),
  }));

  /**
   * El emparejamiento es por texto, así que solo ve `new ImportError("CODE"`
   * con el código literal. Un código calculado —un ternario, una variable—
   * no entra y nadie se entera. Por eso además de contar los throws se
   * verifica que **todos** los códigos declarados aparezcan en alguno: si
   * alguien escribe uno calculado, su código queda huérfano acá.
   */
  it("encuentra los throws del importer", () => {
    expect(calls.length).toBeGreaterThan(10);
  });

  it("cada código declarado se tira desde algún lado con literal", () => {
    const thrown = new Set(calls.map((c) => c.code));
    const source = readFileSync("src/lib/import/import-error.ts", "utf8");
    const union = source.slice(source.indexOf("export type ImportErrorCode"));
    const declared = [...union.matchAll(/\|\s*"(\w+)"/g)].map((m) => m[1]!);

    expect(
      declared.filter((c) => !thrown.has(c)),
      "código declarado que ningún `new ImportError(\"...\")` literal usa: " +
        "o sobra, o se tira con el código calculado y este guardrail no lo ve.",
    ).toEqual([]);
  });

  it.each(calls.map((c) => [c.code, c.params] as const))(
    "%s pasa exactamente los params que su mensaje usa",
    (code, params) => {
      const message = (es.import.importError as Record<string, string>)[code];
      expect(message, `falta el mensaje de "${code}"`).toBeDefined();
      const placeholders = [...message!.matchAll(/\{(\w+)\s*[,}]/g)]
        .map((m) => m[1]!)
        .sort();
      expect(params).toEqual(placeholders);
    },
  );
});

/**
 * El extractor de argumentos ICU es el que sostiene la comparación de
 * placeholders entre idiomas. Si extrae de menos, esa comparación pasa sin
 * mirar nada; si extrae de más, marca falsos positivos y termina apagada.
 * Las dos fallas son silenciosas, así que se prueba contra las formas que
 * existen en `messages/*.json` y contra la que lo rompió.
 */
describe("icuArguments", () => {
  it("levanta un placeholder simple", () => {
    expect(icuArguments("Miembro desde {date}")).toEqual(["date"]);
    expect(icuArguments("{a} y {b}")).toEqual(["a", "b"]);
  });

  it("no confunde las ramas de un plural con argumentos", () => {
    expect(
      icuArguments("{count, plural, one {# torneo} other {# torneos}}"),
    ).toEqual(["count"]);
  });

  /** El caso que rompió el regex anterior: ramas de una sola palabra. */
  it("no confunde las ramas de un select con argumentos", () => {
    expect(
      icuArguments("{type, select, suggestion {Implementada} other {Resuelto}}"),
    ).toEqual(["type"]);
  });

  it("encuentra argumentos anidados DENTRO de una rama", () => {
    // Que la rama no sea un argumento no significa que no pueda contener uno.
    expect(
      icuArguments("{n, plural, one {vino {name}} other {vinieron {name}}}"),
    ).toEqual(["n", "name", "name"]);
  });

  it("soporta selectores `=0` y ramas con markup", () => {
    expect(
      icuArguments("{c, plural, =0 {ninguno} one {<b>#</b>} other {#}}"),
    ).toEqual(["c"]);
  });

  it("no inventa nada ante un mensaje sin argumentos o malformado", () => {
    expect(icuArguments("texto sin nada")).toEqual([]);
    expect(icuArguments("{")).toEqual([]);
    expect(icuArguments("}")).toEqual([]);
  });

  /**
   * Los tags de `t.rich` (`<link>…</link>`) no son argumentos ICU y no
   * tienen que aparecer: van como props del componente, no del mensaje.
   */
  it("ignora los tags de rich text", () => {
    expect(icuArguments("Sin catálogo. <link>Agregar</link> para asociar.")).toEqual([]);
    expect(icuArguments("Llevás <strong>{count}</strong> de {total}.")).toEqual(["count", "total"]);
  });
});
