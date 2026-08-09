import { describe, expect, it } from "vitest";
import { isValidIsoDate, parseIsoDateUtc } from "@/lib/dates";

/**
 * The bug this module exists to end (#201): `Date` does not validate, it
 * **normalises**. `Date.UTC(2026, 1, 31)` is not an error, it is the 3rd of
 * March. So a check that builds a `Date` and looks for a failure never
 * finds one, and a check that range-tests month and day separately accepts
 * every 31st of February ever typed.
 *
 * Three of the repo's four implementations were wrong in one of those two
 * ways. These tests are written against the combinations, because testing
 * "month is 1..12" and "day is 1..31" separately is exactly the mistake.
 */

describe("parseIsoDateUtc — dates that exist", () => {
  it("parses a real date at UTC midnight", () => {
    const date = parseIsoDateUtc("2026-08-06");
    expect(date?.toISOString()).toBe("2026-08-06T00:00:00.000Z");
  });

  // Anchoring anywhere but UTC drifts a calendar date a day west of
  // Greenwich, which is the off-by-one #149 fixed in the formatter.
  it("anchors at UTC, not local time", () => {
    expect(parseIsoDateUtc("2026-01-01")?.getUTCDate()).toBe(1);
    expect(parseIsoDateUtc("2026-01-01")?.getUTCMonth()).toBe(0);
    expect(parseIsoDateUtc("2026-01-01")?.getUTCFullYear()).toBe(2026);
  });

  it("accepts the 29th of February in a leap year", () => {
    expect(parseIsoDateUtc("2024-02-29")).not.toBeNull();
  });
});

describe("parseIsoDateUtc — dates that do not exist", () => {
  /**
   * The headline case from the issue. Every one of these passes a
   * month-in-1..12 and day-in-1..31 check, which is why the two broken
   * copies accepted them.
   */
  it.each([
    ["2026-02-31", "February never has 31 days"],
    ["2026-02-30", "nor 30"],
    ["2026-04-31", "April has 30"],
    ["2026-06-31", "so does June"],
    ["2026-09-31", "and September"],
    ["2026-11-31", "and November"],
    ["2026-02-29", "not a leap year"],
  ])("rejects %s (%s)", (value) => {
    expect(parseIsoDateUtc(value)).toBeNull();
  });

  // These the broken versions did catch — kept so a future rewrite cannot
  // fix the combinations and regress the ranges.
  it.each(["2026-13-01", "2026-00-01", "2026-01-00", "2026-01-32"])(
    "rejects out-of-range %s",
    (value) => {
      expect(parseIsoDateUtc(value)).toBeNull();
    },
  );

  /**
   * `Date.UTC(26, 0, 1)` is 1926: years 0-99 map to 1900-1999. The
   * round-trip catches it because the year that comes back is not the one
   * that went in — no special case needed.
   */
  it("does not fall into the two-digit-year rule", () => {
    expect(parseIsoDateUtc("0026-01-01")).toBeNull();
    expect(parseIsoDateUtc("0000-01-01")).toBeNull();
  });
});

describe("parseIsoDateUtc — shape", () => {
  /**
   * Strict rather than lenient. Postgres renders `date` columns
   * zero-padded, so anything else got here from parsing text — and text
   * that does not match the format is precisely what should not be guessed
   * at.
   */
  it.each([
    "2026-8-6",
    "2026/08/06",
    "06-08-2026",
    "2026-08-06T14:30:00Z",
    "no soy una fecha",
    "",
    "   ",
  ])("rejects %s", (value) => {
    expect(parseIsoDateUtc(value)).toBeNull();
  });
});

describe("isValidIsoDate", () => {
  it("agrees with the parser on every input", () => {
    // The two must never diverge: the import flow branches on the boolean
    // while everything else uses the Date, and a disagreement would mean a
    // date the UI accepted and the parser then refused.
    for (const value of [
      "2026-08-06",
      "2024-02-29",
      "2026-02-31",
      "2026-13-01",
      "2026-8-6",
      "0026-01-01",
      "",
    ]) {
      expect(isValidIsoDate(value), value).toBe(
        parseIsoDateUtc(value) !== null,
      );
    }
  });

  it("rejects the date the old validator let through", () => {
    // The regression, stated plainly: this returned true before #201.
    expect(isValidIsoDate("2026-02-31")).toBe(false);
    expect(isValidIsoDate("2026-08-06")).toBe(true);
  });
});
