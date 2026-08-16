import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardrail against user-facing copy written straight into a component.
 *
 * The i18n work was tracked screen by screen (#146 and friends), and that is
 * exactly how it drifted: an issue enumerates four screens, gets closed, and
 * whatever was not on the list stays in Spanish forever. The catalogue in
 * `messages/` cannot detect this — a string that never became a key simply
 * isn't there to be missing.
 *
 * So the rule is checked against the source instead: inside the rendering
 * layer, user-visible text is a translation call, never a literal.
 *
 * Same shape as the other source-scanning guardrails here — see
 * `no-raw-errors-to-user.test.ts` for the reasoning about sanity checks and
 * comment stripping.
 *
 * ## What this does not catch
 *
 * The scan is textual, so it sees literals where copy is normally written:
 * JSX text nodes and a fixed set of user-facing props. Copy assembled at
 * runtime (a ternary over two variables, a string built from a template) is
 * out of reach, and so is anything outside the two directories below.
 * Widening it is cheap; pretending it is total is not.
 *
 * **Literal lookup tables are deliberately out of scope** (#278). A
 * `Record<string, string>` feeding the render is invisible here, and one
 * really did hide copy — `HistoryTable`'s `POWER_FACTOR_LABELS`. But of the
 * eleven such tables in the rendering layer, eight hold CSS classes; a rule
 * that flags eight correct ones to catch a ninth is a rule someone turns
 * off. The two cases that matter are covered where they are cheaper to
 * catch: copy belongs in `messages/`, and anything keyed *by* locale is
 * guarded by the compiler — see `no-loosely-typed-locale-maps.test.ts`.
 */

const ROOTS = ["app/[locale]", "components"];
const SRC = join(process.cwd(), "src");

/**
 * Literals that are deliberately not translated, each with the reason.
 * An entry here is a decision, not a snooze — anything added without a
 * reason is a bug someone silenced.
 *
 * Sport vocabulary is *not* on this list on purpose. "Stage", "Hit Factor"
 * and "Major" read the same in Spanish and English, but hardcoding them
 * settles the question for every future locale too, and pt-BR wants
 * "Pontos" where English wants "Points". They live in `messages/` and each
 * locale repeats the English term where that is the term.
 */
const ALLOWED = new Set<string>([
  // Product name.
  "HitFactor",
  // The author, credited in the landing footer.
  "Seketman",
  // Placeholder examples in the firearm form: brand and model.
  "Glock",
  "17 Gen 5",
  // Placeholder examples in the ammo form: brand and powder.
  "Hornady",
  "Vihtavuori N320",
  // Example of an uploadable file, shown on the import screen. A file name
  // off a real match, not a sentence.
  "resultados-apertura-fbi.pdf",
]);

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
        out.push(rel);
      }
    }
  };
  for (const root of ROOTS) walk(join(SRC, root), root);
  return out.sort();
}

/**
 * Strips comments, so prose describing the copy isn't flagged as copy.
 *
 * Block comments are blanked rather than deleted: this scan reports line
 * numbers, and dropping their newlines shifts every finding below a doc
 * comment. The sibling guardrails delete them outright because they only
 * ever report file names.
 */
function code(file: string): string {
  return readFileSync(join(SRC, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Props whose value is read by a human: visible labels and the accessible
 * name. `aria-label` and `title` matter as much as body text — a screen
 * reader user gets the untranslated string and nothing else.
 */
const COPY_PROPS = /\b(?:aria-label|alt|header|label|placeholder|title)\s*[=:]\s*"([^"]{2,})"/g;

/**
 * JSX text nodes: everything between a tag's `>` and the next tag's `<`.
 *
 * Braces are allowed through and stripped afterwards, because the usual shape
 * of real copy is text wrapped around interpolations —
 * `{total} acciones · página {page} de {totalPages}`. An earlier version of
 * this scan excluded braces outright and silently ignored every such line,
 * which is most of them.
 *
 * Three anchors keep plain code out:
 *
 *  - `(?<!=)` rejects the `>` of an arrow function.
 *  - The run has to end at a closing tag (`</`), or at an opening tag that
 *    is preceded by whitespace. That second clause is what separates
 *    `text <Link>` from `Record<Tone>`: a generic binds tight to its
 *    identifier, a tag in a text node never does.
 */
const JSX_TEXT = /(?<!=)>([^<>]{2,}?)(?=<\/|(?<=\s)<[A-Za-z])/g;

/** Drops `{…}` expressions, innermost first, leaving only the literal text. */
function stripInterpolations(text: string): string {
  let out = text;
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(/\{[^{}]*\}/g, " ");
  }
  return out;
}

/** A run of letters long enough to be a word rather than a symbol or a unit. */
const HAS_WORD = /\p{L}{3,}/u;

/**
 * `>…<` also spans plain code — a TypeScript generic (`Promise<T>`), a
 * comparison (`length > 0 && …`), a ternary. Those matches carry punctuation
 * that copy never does, which is cheaper to test for than teaching the regex
 * where JSX starts.
 *
 * Erring toward dropping matches is deliberate: a guardrail that cries over
 * correct code gets switched off, and then it guards nothing.
 */
const CODE_PUNCTUATION = /[;={}]|&&|\|\|/;
const STARTS_LIKE_CODE = /^[),.:?[\]]/;

function looksLikeCode(text: string): boolean {
  return CODE_PUNCTUATION.test(text) || STARTS_LIKE_CODE.test(text);
}

type Candidate = { file: string; line: number; text: string };

/** Every literal the scan considers copy, before `ALLOWED` gets a say. */
function candidates(file: string): Candidate[] {
  const src = code(file);
  const found: Candidate[] = [];

  const lineOf = (index: number) => src.slice(0, index).split("\n").length;

  const collect = (re: RegExp, isJsxText: boolean) => {
    for (const match of src.matchAll(re)) {
      const raw = isJsxText ? stripInterpolations(match[1]!) : match[1]!;
      // Copy wraps across lines in JSX; the newlines are layout, not content.
      const text = raw.replace(/\s+/g, " ").trim();
      if (!HAS_WORD.test(text)) continue;
      if (isJsxText && looksLikeCode(text)) continue;
      found.push({ file, line: lineOf(match.index!), text });
    }
  };

  // A quoted prop value is already unambiguous — only the `>…<` scan has to
  // tell copy from code.
  collect(COPY_PROPS, false);
  collect(JSX_TEXT, true);
  return found;
}

describe("no hardcoded UI copy in the rendering layer", () => {
  it("finds files to scan (sanity check)", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(40);
    expect(files).toContain("components/LocaleSwitcher.tsx");
  });

  it("the comment stripper doesn't blank files (sanity check)", () => {
    expect(code("components/LocaleSwitcher.tsx")).toContain("routing.locales");
  });

  it("every user-visible string comes from the catalogue", () => {
    const offenders = sourceFiles()
      .flatMap(candidates)
      .filter((c) => !ALLOWED.has(c.text));

    expect(
      offenders.map((o) => `${o.file}:${o.line}  ${o.text}`),
      `These render literal copy instead of a translated key. Move the text ` +
        `to messages/es.json and messages/en.json and read it with ` +
        `useTranslations/getTranslations. If a literal is genuinely ` +
        `locale-independent (a proper name, a brand), add it to ALLOWED ` +
        `with the reason.`,
    ).toEqual([]);
  });

  /**
   * An allowlist nobody prunes is how a guardrail rots: the string gets
   * deleted or translated, the entry stays, and the next literal that
   * happens to match it sails through unnoticed.
   */
  it("no ALLOWED entry outlived the string it was written for", () => {
    const seen = new Set(sourceFiles().flatMap(candidates).map((c) => c.text));

    expect(
      [...ALLOWED].filter((entry) => !seen.has(entry)),
      `These ALLOWED entries no longer match anything in the scanned ` +
        `sources. Delete them.`,
    ).toEqual([]);
  });
});
