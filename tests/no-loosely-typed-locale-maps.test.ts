import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { routing } from "@/i18n/routing";

/**
 * Guardrail for the other kind of locale-dependent data: not copy, but a
 * value picked *by* locale — a URL, an icon, a short label.
 *
 * These do not belong in `messages/`, so `messages-parity` never sees them,
 * and they are not text in the markup, so `no-hardcoded-ui-strings` never
 * sees them either. Their whole safety net is the type: keyed by `Locale`,
 * adding a locale stops compiling until every entry is filled in; keyed by
 * `string`, it compiles and quietly serves the wrong language.
 *
 * That is not hypothetical. `LaPlataLink`'s Wikipedia map was
 * `Record<string, string>` with an `?? WIKIPEDIA_URL.en` fallback, so pt-BR
 * would have shipped an English article with nothing failing anywhere —
 * while `LocaleSwitcher`'s `Record<Locale, string>` next to it failed the
 * build on the same change, exactly as intended.
 *
 * Widening `no-hardcoded-ui-strings` to literal lookup tables was considered
 * instead and rejected: of the eleven such tables in the rendering layer,
 * eight hold CSS classes. Eight false positives to catch one real problem is
 * how a guardrail earns its way into someone's ignore list.
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

/** Strips comments, so prose about a map is not read as the map. */
function code(file: string): string {
  return readFileSync(join(SRC, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** `const NAME: ANNOTATION = {` — the annotation is optional. */
const DECLARATION = /(?:^|\n)\s*(?:export\s+)?const\s+(\w+)\s*(:[^=\n]+)?=\s*\{/g;

/** `key:` or `"key":` at the start of a line inside an object literal. */
const KEY = /(?:^|\n)\s*(?:"([^"]+)"|(\w+))\s*:/g;

type Offender = { file: string; line: number; name: string };

function offenders(file: string): Offender[] {
  const src = code(file);
  const found: Offender[] = [];

  for (const match of src.matchAll(DECLARATION)) {
    const [, name, annotation] = match;
    const open = src.indexOf("{", match.index!);
    const close = src.indexOf("\n};", open);
    if (close === -1 || close - open > 2000) continue;

    const body = src.slice(open, close);
    const keys = new Set(
      [...body.matchAll(KEY)].map((k) => k[1] ?? k[2]!),
    );
    const localeKeys = routing.locales.filter((l) => keys.has(l));

    // Two is the threshold on purpose: one locale key is as likely to be a
    // field that happens to be called `es` as it is to be a locale map.
    if (localeKeys.length < 2) continue;
    if (annotation?.includes("Locale")) continue;

    // Anchored on `const`, not on `match.index`: the pattern opens with
    // `(?:^|\n)\s*`, and that `\s*` walks across the blank lines a blanked
    // doc comment leaves behind, so the match starts well above the
    // declaration it found.
    const declaredAt = match.index! + match[0].indexOf("const");

    found.push({
      file,
      line: src.slice(0, declaredAt).split("\n").length,
      name: name!,
    });
  }
  return found;
}

describe("maps keyed by locale are typed by Locale", () => {
  it("finds files to scan (sanity check)", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("components/LaPlataLink.tsx");
  });

  it("the scan recognises a locale map at all (sanity check)", () => {
    // `LocaleSwitcher`'s LABELS is the shape this test is about, correctly
    // typed. If the scan stops seeing it, it sees nothing and passes empty.
    const src = code("components/LocaleSwitcher.tsx");
    expect(src).toMatch(/const LABELS: Record<Locale, string>/);
    expect(offenders("components/LocaleSwitcher.tsx")).toEqual([]);
  });

  it("no map keyed by locale is typed loosely", () => {
    const all = sourceFiles().flatMap(offenders);

    expect(
      all.map((o) => `${o.file}:${o.line}  ${o.name}`),
      `These are keyed by locale but not typed by it, so adding a locale ` +
        `compiles and silently serves whatever the fallback is. Annotate ` +
        `them \`Record<Locale, …>\` — the compiler is the guardrail here, ` +
        `these values do not belong in messages/.`,
    ).toEqual([]);
  });
});
