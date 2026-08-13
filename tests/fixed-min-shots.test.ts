import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { DISCIPLINE, FBI_MIN_SHOTS, fixedMinShots } from "@/lib/disciplines";

/**
 * `fixedMinShots` in `lib/disciplines.ts` states the rule and what a wrong
 * value costs. This file does not restate it — it checks it, and checks that
 * every writer of the column asks (#263).
 */

describe("fixedMinShots", () => {
  it("gives FBI its fixed round count", () => {
    expect(fixedMinShots(DISCIPLINE.FBI)).toBe(45);
  });

  /**
   * The literal 45 above rather than `FBI_MIN_SHOTS`: comparing the code
   * against the constant it already returns would pass whatever the constant
   * said. This one keeps the two in step.
   */
  it("returns exactly the exported constant", () => {
    expect(FBI_MIN_SHOTS).toBe(45);
  });

  it("leaves every other discipline to the importer", () => {
    expect(fixedMinShots(DISCIPLINE.IPSC)).toBeNull();
    expect(fixedMinShots(DISCIPLINE.STEEL)).toBeNull();
    expect(fixedMinShots(DISCIPLINE.COMBAT)).toBeNull();
  });

  /**
   * The snapshot the edit action reads embeds `disciplines(code)`, which is
   * nullable in the type. A missing discipline must not be read as "fixed" —
   * that would block edits on every match the join failed to resolve.
   */
  it("treats an unknown or absent discipline as not fixed", () => {
    expect(fixedMinShots(null)).toBeNull();
    expect(fixedMinShots(undefined)).toBeNull();
    expect(fixedMinShots("")).toBeNull();
    expect(fixedMinShots("tiro_fbi_veterano")).toBeNull();
  });
});

/**
 * A rule is only as good as its coverage of the writers, and #263 existed
 * because a writer was added without it. Neither the server action nor the UI
 * is reachable from a unit test here — no `next/headers`, no DOM — so this
 * scans instead, the same way `no-raw-errors-to-user` and `no-host-header-urls`
 * do.
 */
describe("every writer of matches.min_shots consults the rule", () => {
  const ROOT = process.cwd();

  /**
   * The detector, exported to the tests below so its blind spots are findable.
   *
   * It deliberately does NOT try to match the write expression itself. The
   * first attempt did — `.update({ … min_shots … })` — and three ordinary
   * shapes walked straight past it: `.upsert(…)`, a payload built into a
   * variable first, and any object with a nested brace before the column. A
   * guardrail that a refactor can silently disable is worse than none, since
   * its green tick is what stops anyone looking.
   *
   * So the question is the coarser one: does this file write to the database
   * at all, and does it mention the column outside a comment? False positives
   * here cost one line in an allowlist; a false negative costs the bug back.
   *
   * Matching the bare column name is what makes it coarse — `min_shots:` also
   * appears in every type declaration (`db/types.ts`, the generated
   * `database.types.ts`), which is why the write call has to be there too.
   */
  const MENTIONS_COLUMN = /\bmin_shots\b/;
  const WRITES_ANYTHING = /\.(?:insert|update|upsert)\s*\(/;
  const CALLS_HELPER = /\bupdateMatchMinShots\s*\(/;

  function isWriter(source: string): boolean {
    const code = stripComments(source);
    return (
      (MENTIONS_COLUMN.test(code) && WRITES_ANYTHING.test(code)) ||
      CALLS_HELPER.test(code)
    );
  }

  /**
   * Comments go first: the rule is described in prose in `disciplines.ts` and
   * in the doc comments of the writers, and a scanner that reads its own
   * documentation as a hit is a mistake this repo has now made three times.
   */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  /**
   * `db/matches.ts` holds the raw `update`, deliberately without the check:
   * it has no locale and no translator, so it cannot tell the user why an
   * edit was refused. Its caller does that. Anything else appearing here is a
   * new writer that has to be looked at.
   */
  const ALLOWED = [join("src", "lib", "db", "matches.ts")];

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  const writers = walk(join(ROOT, "src"))
    .map((file) => ({ file, source: readFileSync(file, "utf8") }))
    .filter(({ source }) => isWriter(source))
    .map(({ file, source }) => ({
      file: relative(ROOT, file),
      source: stripComments(source),
    }));

  /**
   * The detector checked against the shapes that defeated its first version.
   * Without these, hardening it is a claim rather than a fact — and the only
   * signal anyone gets from this file is whether it went green.
   */
  it("detects every shape of write, not just an inline object literal", () => {
    const shapes = {
      inlineLiteral: `supabase.from("matches").update({ min_shots: n })`,
      upsert: `supabase.from("matches").upsert({ min_shots: n })`,
      insert: `supabase.from("matches").insert({ name, min_shots: n })`,
      variablePayload: `const p = { min_shots: n }; supabase.from("matches").update(p)`,
      nestedBraceFirst: `supabase.from("matches").update({ meta: { a: 1 }, min_shots: n })`,
      viaHelper: `await matchesDb.updateMatchMinShots(supabase, id, n)`,
    };

    for (const [shape, source] of Object.entries(shapes)) {
      expect(isWriter(source), `missed the ${shape} shape`).toBe(true);
    }
  });

  it("does not flag reads, type declarations or prose", () => {
    const innocent = {
      typeDeclaration: `interface Match { min_shots: number | null }`,
      select: `supabase.from("matches").select("id, min_shots")`,
      writeToAnotherTable: `supabase.from("stages").insert({ name })`,
      commentOnly: `// min_shots is fixed for FBI\nfoo.update({ x: 1 })`,
    };

    for (const [shape, source] of Object.entries(innocent)) {
      expect(isWriter(source), `false positive on ${shape}`).toBe(false);
    }
  });

  /**
   * Snapshotted rather than counted. A count passes just as happily when the
   * regex breaks and finds a different three, and a new writer appearing here
   * is exactly the moment someone has to decide whether the rule applies to
   * it — which is the decision that was skipped when this hole was opened.
   */
  it("finds the writers, and only these", () => {
    expect(
      writers.map((w) => w.file).sort(),
      "A file gained or lost the ability to write matches.min_shots. If it is " +
        "new, decide whether the discipline's fixed round count applies to it " +
        "before updating this snapshot — skipping that decision is what left " +
        "the rule holding on import and nowhere else (#263). If the list " +
        "shrank, the detector above probably stopped matching a real write.",
    ).toMatchInlineSnapshot(`
      [
        "src/app/[locale]/(app)/matches/[id]/actions.ts",
        "src/lib/db/matches.ts",
        "src/lib/import/import-match.ts",
      ]
    `);
  });

  it("each one calls fixedMinShots, or is a listed exception", () => {
    const unchecked = writers
      .filter((w) => !ALLOWED.includes(w.file))
      .filter((w) => !/\bfixedMinShots\s*\(/.test(w.source))
      .map((w) => w.file);

    expect(
      unchecked,
      "These write matches.min_shots without asking fixedMinShots() whether " +
        "the discipline fixes it. That is how #263 happened: the rule held on " +
        "import and nowhere else, and a wrong value renders as a plausible " +
        "number in the extra-rounds KPI rather than as an error.",
    ).toEqual([]);
  });
});
