import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { asMetadata } from "@/lib/db/audit";

/**
 * `db/` declares several fields narrower than the `text` column they are read
 * from — `power_factor` as `"Min" | "Maj" | null`, and the `type`/`status`
 * pairs on ammunition and feedback. Those assertions are sound because
 * Postgres refuses to store anything else, and for no other reason. See the
 * header of `src/lib/db/types.ts`.
 *
 * That makes them trust with a dependency, which is the kind this repo keeps
 * getting caught by: drop the CHECK in a migration and nothing anywhere goes
 * red, the type keeps promising a union the column no longer honours, and the
 * first symptom is a value rendering as blank somewhere months later.
 *
 * So each one is pinned here against the migration that grants it. The
 * assertion is set equality, not mere presence, because the two ways this can
 * rot are symmetric: a migration that widens the CHECK without widening the
 * union is just as wrong as a union widened without the migration.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

const migrations = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"));

const schema = migrations.join("\n");

const values = (list: string) =>
  [...list.matchAll(/'([^']*)'/g)].map((m) => m[1]!).sort();

/**
 * The CHECK constraints the schema **ends up** with, keyed `table.column`.
 *
 * Replaying the migrations in order rather than scanning the concatenated text
 * is the whole point. This repo widens a CHECK by dropping and re-adding it
 * (`0004` and `0015` both do it to `matches.source_type`), so a text scan
 * happily returns a constraint that a later migration deleted — the earlier
 * version of this file reported `source_type`'s original eight values while
 * the live constraint has ten.
 *
 * Two earlier mistakes are also fixed here, both of the same kind: a guardrail
 * that reports less than it claims, whose green tick is what stops anyone
 * looking. Keying by column alone covered three of five constraints, because
 * three columns are called `type` and two `power_factor`. And a separate
 * "no migration drops these" test matched `drop constraint (\S+)`, which
 * against this repo's actual `drop constraint if exists <name>` captured the
 * word `if`. That test is gone: replaying the drops makes it unnecessary,
 * and it could not have told a plain drop from the drop-and-widen above.
 */
function finalConstraints(): Map<string, string[]> {
  const byColumn = new Map<string, string[]>();
  /** Constraint name → `table.column`, so a later drop knows what it removes. */
  const named = new Map<string, string>();

  const remember = (table: string, column: string, list: string) => {
    const at = `${table}.${column}`;
    byColumn.set(at, values(list));
    // Postgres names an inline column CHECK `<table>_<column>_check`, which is
    // exactly the name 0004 and 0015 drop.
    named.set(`${table}_${column}_check`, at);
    return at;
  };

  /**
   * One alternation rather than three passes, so the statements arrive in the
   * order they were written. Three passes got this wrong: `0015` drops the
   * constraint on the line above the one that re-adds it, and handling every
   * add before every drop deleted what had just been restored.
   */
  const STATEMENT = new RegExp(
    [
      String.raw`create table (?:if not exists )?public\.(?<ctTable>\w+)\s*\((?<ctBody>[\s\S]*?)\n\);`,
      String.raw`alter table\s+(?:public\.)?(?<atTable>\w+)\s+add constraint\s+(?<addName>\w+)\s+check\s*\(\s*(?<addCol>\w+)\s+in\s*\((?<addList>[^)]*)\)`,
      String.raw`drop constraint\s+(?:if exists\s+)?(?<dropName>\w+)`,
    ].join("|"),
    "gi",
  );

  for (const sql of migrations) {
    for (const m of sql.matchAll(STATEMENT)) {
      const g = m.groups!;

      if (g.ctTable !== undefined) {
        // The backreference keeps a column's CHECK from being read off a
        // neighbouring column's clause.
        for (const [, column, list] of g.ctBody!.matchAll(
          /^\s*(\w+)\s+\w+[^,]*?check\s*\(\s*\1\s+in\s*\(([^)]*)\)/gim,
        )) {
          remember(g.ctTable, column!, list!);
        }
      } else if (g.atTable !== undefined) {
        named.set(g.addName!, remember(g.atTable, g.addCol!, g.addList!));
      } else if (g.dropName !== undefined) {
        const at = named.get(g.dropName);
        if (at) byColumn.delete(at);
      }
    }
  }

  return byColumn;
}

const CONSTRAINTS = finalConstraints();

/**
 * `table.column` → the union `db/types.ts` narrows it to. Adding a narrowed
 * field to `db/` means adding it here; that is the point of the file.
 */
const NARROWED = [
  { at: "match_entries.power_factor", union: ["Maj", "Min"] },
  { at: "ammunition_types.power_factor", union: ["Maj", "Min"] },
  { at: "ammunition_types.type", union: ["factory", "reload"] },
  { at: "feedback.type", union: ["bug", "other", "suggestion"] },
  {
    at: "feedback.status",
    union: ["done", "duplicate", "in_progress", "new", "triaged", "wontdo"],
  },
];

describe("narrow unions in db/ are backed by a CHECK constraint", () => {
  it.each(NARROWED)(
    "$at is constrained, and to exactly the union db/ declares",
    ({ at, union }) => {
      expect(
        CONSTRAINTS.get(at),
        `No CHECK constraint found for "${at}" in supabase/migrations/. ` +
          `db/types.ts narrows this column to a union, and the constraint is ` +
          `the only thing making that true — see the header of db/types.ts.`,
      ).toBeDefined();

      expect(
        CONSTRAINTS.get(at),
        `The CHECK on "${at}" and the union in db/types.ts disagree. ` +
          `Whichever moved, the other has to follow: the cast in db/ promises ` +
          `callers a value the column may no longer be limited to.`,
      ).toEqual(union);
    },
  );

  /**
   * The canary for the replay itself, and the reason it exists.
   *
   * `matches.source_type` is not narrowed in `db/`, so nothing above depends
   * on it — which is what makes it a good probe. It is the one column here
   * whose CHECK was created inline, then dropped and re-added wider twice
   * (`0004`, `0015`). A parser that reads the concatenated text instead of
   * replaying the migrations returns the original eight values; the live
   * constraint has ten. If this ever reports eight again, every assertion
   * above is reading a schema that no longer exists.
   */
  it("follows a constraint that was dropped and re-added wider", () => {
    expect(CONSTRAINTS.get("matches.source_type")).toContain("fat_pdf");
    expect(CONSTRAINTS.get("matches.source_type")).toContain(
      "practiscore_steel_pdf",
    );
    expect(CONSTRAINTS.get("matches.source_type")).toHaveLength(10);
  });

  /**
   * Guards the parser rather than the schema, and snapshots the whole set
   * rather than counting it. A count passes just as happily when the regex
   * breaks and finds a different five; a new constrained column appearing
   * here is the moment to ask whether `db/` narrows it too.
   */
  it("parses every CHECK in the schema, and only these", () => {
    expect([...CONSTRAINTS.keys()].sort()).toMatchInlineSnapshot(`
      [
        "ammunition_types.power_factor",
        "ammunition_types.type",
        "feedback.status",
        "feedback.type",
        "match_entries.power_factor",
        "matches.source_type",
      ]
    `);
  });
});

describe("asMetadata — the narrowing without a constraint behind it", () => {
  /**
   * The other narrowings are decided by the schema, so getting one wrong takes
   * a migration. This one is decided in TypeScript, which makes it the only
   * one that can rot on its own — and it changes what `/activity` renders for
   * a malformed row, so the behaviour is pinned rather than assumed.
   */
  it("passes plain objects through untouched", () => {
    const before = { min_shots: 45 };
    expect(asMetadata({ before }, 1)).toEqual({ before });
  });

  it("keeps null as null, without complaining", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(asMetadata(null, 1)).toBeNull();
    expect(asMetadata(undefined, 1)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  /**
   * The cases JSONB accepts and the domain type does not. An array is called
   * out separately because `typeof [] === "object"` — the check that lets one
   * through is the easy one to write.
   */
  it.each([
    ["a string", "just text"],
    ["a number", 42],
    ["a boolean", true],
    ["an array", [{ before: 1 }]],
  ])("reads %s as null", (_label, value) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(asMetadata(value, 7)).toBeNull();
    warn.mockRestore();
  });

  /**
   * Degrading quietly is the failure mode this codebase keeps paying for, so
   * the warning is part of the contract, not a debugging leftover. It carries
   * the row id because "some row somewhere is malformed" is not actionable.
   */
  it("says so in the log, with the row that was wrong", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    asMetadata("just text", 99);

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]![0]);
    expect(message).toContain("99");
    expect(message).toContain("string");
    warn.mockRestore();
  });
});

describe("audit_log.metadata is the documented exception", () => {
  /**
   * `db/audit.ts` validates metadata at runtime instead of asserting it, and
   * the reason is that this column has no constraint. If one is ever added,
   * that runtime check becomes dead weight and should go — this test is what
   * would say so.
   */
  it("has no CHECK constraint, which is why db/audit.ts validates it", () => {
    expect(CONSTRAINTS.get("audit_log.metadata")).toBeUndefined();
    expect(schema).toMatch(/metadata\s+jsonb/i);
  });
});
