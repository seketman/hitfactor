import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { shooterNameKey } from "@/lib/names";
import { accentFoldedName } from "@/lib/parsers/fat-pdf";
import { claimNameKey } from "@/lib/import/match-claim";

/**
 * Three keys normalize a shooter's name, and they are meant to *disagree*.
 * This file pins each one and, more importantly, pins the disagreements.
 *
 * **`src/lib/names.ts` is where the three are compared and justified.** It is
 * not repeated here on purpose: until #124 this fact lived as prose in two
 * files that had drifted into contradicting each other, which is the whole
 * reason any of this needed fixing.
 *
 * What this file adds is teeth. The risk is not a failing test — it is an
 * import that succeeds and lands one competitor's results on another's
 * profile, or splits one competitor into two records, with nothing raised
 * either way. So the assertions below are written as *disagreement*: a change
 * that makes any two of these keys agree where they must not has to come here
 * and delete a test named after the reason it exists.
 */

describe("shooterNameKey — parsed name vs. a name already in the database", () => {
  it("lowercases and collapses whitespace", () => {
    expect(shooterNameKey("  GUSTAVO   CASTAGNETO  ")).toBe(
      "gustavo castagneto",
    );
  });

  it("collapses tabs and newlines, not just spaces", () => {
    expect(shooterNameKey("GUSTAVO\tCASTAGNETO\nJR")).toBe(
      "gustavo castagneto jr",
    );
  });

  it("preserves accents — this is the whole point of it", () => {
    expect(shooterNameKey("Núñez, Iván")).toBe("núñez, iván");
  });

  it("keeps punctuation", () => {
    expect(shooterNameKey("St. John, A.")).toBe("st. john, a.");
  });

  it("maps blank input to the empty string", () => {
    expect(shooterNameKey("")).toBe("");
    expect(shooterNameKey("   ")).toBe("");
  });
});

describe("accentFoldedName — one competitor across sections of one FAT PDF", () => {
  it("folds accents and uppercases", () => {
    expect(accentFoldedName("Núñez, Iván")).toBe("NUNEZ, IVAN");
  });

  /**
   * The example from the parser's own doc comment, and the reason folding
   * exists at all: these two spellings appear in the same document.
   */
  it("makes the two spellings in the source document meet", () => {
    expect(accentFoldedName("GUSTAVO CASTAGÑETO")).toBe(
      accentFoldedName("GUSTAVO CASTAGNETO"),
    );
  });

  it("keeps punctuation", () => {
    expect(accentFoldedName("St. John, A.")).toBe("ST. JOHN, A.");
  });

  it("maps blank input to the empty string", () => {
    expect(accentFoldedName("")).toBe("");
    expect(accentFoldedName("   ")).toBe("");
  });
});

describe("claimNameKey — a user's claim vs. candidate shooters", () => {
  it("folds accents and lowercases", () => {
    expect(claimNameKey("Núñez, Iván")).toBe("nunez ivan");
  });

  it("drops commas and periods, which the other two keep", () => {
    expect(claimNameKey("St. John, A.")).toBe("st john a");
  });
});

/**
 * The table that matters. One input, three keys, and who is allowed to agree
 * with whom.
 */
describe("the three keys disagree, on purpose", () => {
  const INPUT = "CASTAGÑETO, José";

  it("produces three different results for the same name", () => {
    expect({
      shooter: shooterNameKey(INPUT),
      folded: accentFoldedName(INPUT),
      claim: claimNameKey(INPUT),
    }).toEqual({
      shooter: "castagñeto, josé",
      folded: "CASTAGNETO, JOSE",
      claim: "castagneto jose",
    });
  });

  /**
   * The invariant with teeth. `shooterNameKey` decides whether a parsed row
   * attaches to an existing `shooters` record, so folding there would merge
   * two real competitors whose surnames differ by a tilde. The other two are
   * allowed to merge them — one deduplicates inside a single document, the
   * other only proposes candidates a human confirms.
   */
  it("only shooterNameKey keeps two accent-distinct people apart", () => {
    const withAccent = "Núñez, Iván";
    const without = "Nunez, Ivan";

    expect(shooterNameKey(withAccent)).not.toBe(shooterNameKey(without));

    expect(accentFoldedName(withAccent)).toBe(accentFoldedName(without));
    expect(claimNameKey(withAccent)).toBe(claimNameKey(without));
  });

  /**
   * The second axis. `claimNameKey` is the only one that drops `,` and `.`,
   * because a claim typed as "Perez Jose" has to reach a shooter stored as
   * "Perez, Jose". The other two compare against text that keeps its
   * punctuation on both sides, so dropping it there would only lose signal.
   */
  /**
   * `accentFoldedName` is exported so this file can pin it, and its doc says
   * nothing else should call it. A comment cannot enforce that, and an
   * unenforced "do not call this" on a fold-accents helper is exactly the
   * hazard #124 was filed about — the old `normalizeName` was exported too,
   * which is what made importing the wrong one a mistake that compiled.
   *
   * Scanned rather than lint-ruled to match the repo's other guardrails
   * (`no-host-header-urls`, `no-raw-errors-to-user`).
   *
   * It matches import and re-export statements, not every occurrence of the
   * identifier: `lib/names.ts` names all three keys in its comparison table
   * and a plain text search flags it. Third guardrail in this repo to trip
   * over documentation that mentions what it forbids.
   */
  it("nothing outside fat-pdf and this file imports accentFoldedName", () => {
    const ROOT = process.cwd();
    const ALLOWED = [
      join("src", "lib", "parsers", "fat-pdf.ts"),
      join("tests", "name-normalization.test.ts"),
    ];

    function walk(dir: string): string[] {
      const out: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
      }
      return out;
    }

    /** `import { …, accentFoldedName, … } from "…"`, and re-exports of it. */
    const IMPORTS = /(?:import|export)\s*\{[^}]*\baccentFoldedName\b[^}]*\}/;

    const offenders = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "tests"))]
      .filter((f) => !ALLOWED.includes(relative(ROOT, f)))
      .filter((f) => IMPORTS.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f));

    expect(
      offenders,
      "accentFoldedName folds accents, which merges two competitors whose " +
        "surnames differ by a tilde. Outside the FAT parser that is a bug — " +
        "see src/lib/names.ts for which key to use instead.",
    ).toEqual([]);
  });

  it("only claimNameKey ignores punctuation", () => {
    const punctuated = "Perez, Jose";
    const plain = "Perez Jose";

    expect(claimNameKey(punctuated)).toBe(claimNameKey(plain));

    expect(shooterNameKey(punctuated)).not.toBe(shooterNameKey(plain));
    expect(accentFoldedName(punctuated)).not.toBe(accentFoldedName(plain));
  });
});
