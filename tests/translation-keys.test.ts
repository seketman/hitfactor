import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import es from "../messages/es.json";
import en from "../messages/en.json";

/**
 * Toda clave que el código le pide a next-intl tiene que existir en los dos
 * idiomas.
 *
 * `messages-parity` ya cubre la otra mitad —que `es` y `en` tengan las
 * mismas claves— pero nada verificaba que las claves que **usa el código**
 * existan. Es el mismo modo de falla silencioso de siempre: next-intl no
 * tira ante una clave faltante, devuelve `"<namespace>.<clave>"`, así que
 * un typo se renderiza literal en la pantalla y no rompe ningún test, ni el
 * build, ni el typecheck.
 *
 * Apareció traduciendo `firearms` (#146): 56 claves nuevas escritas a mano
 * en dos archivos JSON y referenciadas desde cinco componentes, sin nada
 * que emparejara las dos puntas.
 */

const SRC = join(process.cwd(), "src");

function sourceFiles(dir = SRC, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...sourceFiles(join(dir, entry.name), rel));
    else if (/\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out.sort();
}

/** `const t = useTranslations("ns")` / `= await getTranslations("ns")`. */
const BINDING =
  /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:use|get)Translations\(\s*"([^"]+)"\s*\)/g;

/** `t("clave")` o `t.rich("clave")`, con la clave literal. */
const CALL = (variable: string) =>
  new RegExp(`\\b${variable}(?:\\.rich)?\\(\\s*"([^"]+)"`, "g");

/**
 * Llamada cuya clave NO es un literal: `t(\`ns.${code}\`)`, `t(TABLA[x])`,
 * `t(variable)`. Se define por descarte —lo que no abre con comilla— en vez
 * de enumerar formas: enumerar deja afuera la que a nadie se le ocurrió, y
 * la primera que se escapó fue justamente `t(TYPE_KEYS[r.type])`, que no es
 * un template literal.
 */
const DYNAMIC_CALL = (variable: string) =>
  new RegExp(`\\b${variable}(?:\\.rich)?\\(\\s*[^"\\s)]`, "g");

function lookup(messages: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      messages,
    );
}

interface Usage {
  file: string;
  /**
   * Todos los namespaces que el archivo liga, no el de esta llamada.
   *
   * Un archivo puede tener varios `const t = useTranslations(...)` —uno por
   * componente— y con regex no hay forma de saber qué binding alcanza a
   * cada llamada. Emparejar por nombre de variable hace que una clave se
   * valide contra namespaces que no le corresponden, y ahí el test reporta
   * faltantes que no lo son. Un guardrail que grita en falso se termina
   * desactivando, así que se pide que la clave exista en **alguno** de los
   * namespaces del archivo.
   *
   * Es más débil de lo ideal y no miente: un typo no existe en ninguno, que
   * es el caso que importa.
   */
  namespaces: string[];
  key: string;
}

const usages: Usage[] = [];
const dynamicSites = new Set<string>();

for (const file of sourceFiles()) {
  const source = readFileSync(join(SRC, file), "utf8")
    // Se sacan los comentarios: un ejemplo de uso escrito en prosa no es
    // una llamada real. Lección de `no-host-header-urls.test.ts`.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  const bindings = [...source.matchAll(BINDING)];
  if (bindings.length === 0) continue;
  const namespaces = [...new Set(bindings.map((b) => b[2]!))];

  for (const variable of new Set(bindings.map((b) => b[1]!))) {
    for (const [, key] of source.matchAll(CALL(variable))) {
      usages.push({ file, namespaces, key: key! });
    }
    // Se registra el ARCHIVO y no la posición: un índice de byte se mueve
    // con cualquier edición y volvería el snapshot ruido puro. A nivel
    // archivo, lo que dispara es que una ruta NUEVA empiece a armar claves
    // en runtime — que es cuando hay que pensar en su cobertura.
    if (DYNAMIC_CALL(variable).test(source)) dynamicSites.add(file);
  }
}

describe("claves de traducción usadas en el código", () => {
  /**
   * Sin esto un regex roto deja `usages` vacío y todos los asserts de abajo
   * pasan sin haber mirado nada.
   */
  it("encuentra usos para analizar (sanity check)", () => {
    expect(usages.length).toBeGreaterThan(100);
    expect(new Set(usages.flatMap((u) => u.namespaces)).size).toBeGreaterThan(4);
  });

  it.each(["es", "en"])("todas existen en %s", (locale) => {
    const messages = locale === "es" ? es : en;
    const missing = usages
      .filter(
        (u) =>
          !u.namespaces.some(
            (ns) => typeof lookup(messages, `${ns}.${u.key}`) === "string",
          ),
      )
      .map((u) => `${u.file}: ${u.namespaces.join("|")}.${u.key}`);

    expect(
      [...new Set(missing)],
      `Estas claves se piden desde el código y no existen en messages/${locale}.json. ` +
        `next-intl no falla ante una clave faltante: imprime "<namespace>.<clave>" ` +
        `en la pantalla, así que el error solo se ve mirando la app.`,
    ).toEqual([]);
  });

  /**
   * Las claves armadas en runtime (`t(\`parserError.${code}\`)`) no se
   * pueden resolver acá. No se ignoran en silencio: se cuentan, y su
   * cobertura vive en los bloques `<Error>Code ↔ messages` de
   * `messages-parity`, que emparejan la unión de códigos contra el
   * catálogo. Si aparece un archivo nuevo en esta lista, hace falta
   * decidir cómo se cubre — no alcanza con actualizar el snapshot.
   */
  it("las claves dinámicas son las conocidas y están cubiertas aparte", () => {
    // Los sitios de hoy: los códigos de error del import (upload, parser e
    // import), el de auth en login, y los `step<N>`/`feature<N>` que el
    // landing arma en loop.
    expect([...dynamicSites].sort()).toMatchInlineSnapshot(`
      [
        "app/[locale]/(app)/import/ImportForm.tsx",
        "app/[locale]/(app)/import/actions.ts",
        "app/[locale]/(auth)/login/page.tsx",
        "components/HistoryTable.tsx",
        "components/landing/LandingPage.tsx",
      ]
    `);
  });
});
