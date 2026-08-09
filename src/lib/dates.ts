/**
 * Calendar-date primitives (#201).
 *
 * **`Date` does not validate — it normalises.** `Date.UTC(2026, 1, 31)` is
 * not an error, it is the 3rd of March. So does `new Date("2026-02-31")` in
 * some engines. Any check that builds a `Date` and looks for a failure finds
 * none, and any check that range-tests month and day separately accepts
 * every 31st of February ever written.
 *
 * The repo had four takes on this. `formatDate` got it right, with a
 * round-trip comparing all three components back out; `isValidIsoDate` in
 * the import actions and a byte-identical copy in the FAT PDF parser both
 * range-tested in isolation and accepted `2026-02-31`; and `parseIsoDate`
 * in `shooter-stats` built the date and returned it unchecked. This module
 * is the one that was right, extracted, so there is one to be wrong in.
 */

/**
 * Parses a strict `YYYY-MM-DD` string into a `Date` at UTC midnight, or
 * `null` if that date does not exist on the calendar.
 *
 * UTC on both ends is deliberate and has to stay that way: a calendar date
 * has no time and no place, so anchoring it anywhere else drifts it a day
 * west of Greenwich. See `formatDate`, which pins its formatter to UTC to
 * match.
 *
 * Strict about the shape as well as the value: `2026-8-6` is rejected
 * rather than guessed at. Postgres renders `date` columns zero-padded, so
 * anything else reaching here came from parsing text, and text that does
 * not match the format is exactly what should not be silently accepted.
 *
 * The round-trip also catches the legacy two-digit-year rule for free:
 * `Date.UTC(26, 0, 1)` is 1926, so the year that comes back out is not the
 * one that went in, and `0026-01-01` is refused instead of quietly becoming
 * a 20th-century date.
 */
export function parseIsoDateUtc(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/**
 * True when `value` is a real calendar date in `YYYY-MM-DD` form.
 *
 * This is what the import flow shows the user `invalidDate` for. Getting it
 * wrong does not let bad data through — Postgres rejects an impossible date
 * at the `date` column either way — it just means the user gets a raw
 * constraint error instead of the clear message this check exists to
 * produce.
 */
export function isValidIsoDate(value: string): boolean {
  return parseIsoDateUtc(value) !== null;
}
