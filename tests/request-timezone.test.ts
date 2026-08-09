import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `getRequestTimeZone` is the boundary where an untrusted value becomes the
 * time zone the whole page renders in (#190), so both halves matter: it has
 * to pass a real IANA name through, and it has to refuse anything else
 * rather than hand it to `Intl.DateTimeFormat` — which throws `RangeError`
 * on an unknown zone, and would turn a bad header into a 500 on a page that
 * is otherwise fine.
 */

const headersMock = vi.fn();
vi.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

/** Stands in for the real `headers()` result: only `.get` is used. */
function withHeader(value: string | null) {
  headersMock.mockResolvedValue({ get: () => value });
}

beforeEach(() => {
  headersMock.mockReset();
});

describe("getRequestTimeZone", () => {
  it("uses the IANA name the edge resolved from the visitor's IP", async () => {
    const { getRequestTimeZone } = await import("@/lib/timezone");
    withHeader("America/Argentina/Buenos_Aires");
    await expect(getRequestTimeZone()).resolves.toBe(
      "America/Argentina/Buenos_Aires",
    );
  });

  // Local dev and self-hosting never see the header — Vercel's edge is what
  // sets it. Falling back rather than throwing is what keeps `next dev`
  // working.
  it("falls back to UTC when the header is absent", async () => {
    const { getRequestTimeZone, FALLBACK_TIME_ZONE } = await import(
      "@/lib/timezone"
    );
    withHeader(null);
    await expect(getRequestTimeZone()).resolves.toBe(FALLBACK_TIME_ZONE);
    expect(FALLBACK_TIME_ZONE).toBe("UTC");
  });

  it("falls back rather than passing a bad value to Intl", async () => {
    const { getRequestTimeZone, FALLBACK_TIME_ZONE } = await import(
      "@/lib/timezone"
    );
    for (const bad of [
      "",
      "   ",
      "Marte/Olympus_Mons",
      "GMT-3",
      "'; drop table shooters; --",
    ]) {
      withHeader(bad);
      await expect(getRequestTimeZone()).resolves.toBe(FALLBACK_TIME_ZONE);
    }
  });

  /**
   * Offset identifiers like `-03:00` are the one input whose handling is not
   * fixed: ES2024 made them valid time zones, so a new enough ICU accepts
   * them and this passes them through, while an older one rejects them and
   * it falls back. Node 20 (what CI runs, per `.github/workflows/ci.yml`)
   * and Node 25 (what this was written on) land on opposite sides — the
   * first version of this test hardcoded the newer answer and went red on
   * CI only.
   *
   * So the expectation is derived at runtime rather than written down. What
   * is asserted is the invariant that holds either way: the helper never
   * returns a value its own validity check would reject.
   *
   * That makes this test a link in a chain, not a standalone claim — it is
   * `isValidTimeZone` on both sides, so on its own it would pass vacuously
   * if that function broke. What anchors it to reality is
   * "accepts exactly what Intl accepts" below, which compares
   * `isValidTimeZone` against raw `Intl`. The two together give the real
   * property; either alone does not.
   *
   * Neither outcome is a problem in production: Vercel's edge only ever
   * sends IANA names, so an offset never arrives, and where it is accepted
   * it still renders a correct wall clock — it just cannot follow DST.
   */
  it("agrees with Intl on offset identifiers, whichever way it goes", async () => {
    const { getRequestTimeZone, isValidTimeZone } = await import(
      "@/lib/timezone"
    );
    withHeader("-03:00");
    const expected = isValidTimeZone("-03:00") ? "-03:00" : "UTC";
    await expect(getRequestTimeZone()).resolves.toBe(expected);
  });
});

describe("isValidTimeZone", () => {
  it("accepts zones and rejects everything else", async () => {
    const { isValidTimeZone } = await import("@/lib/timezone");
    // UTC and both hemispheres, since the app renders in all three.
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("America/Argentina/Buenos_Aires")).toBe(true);
    expect(isValidTimeZone("Asia/Tokyo")).toBe(true);
    expect(isValidTimeZone("Marte/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  /**
   * The contract that matters: whatever this accepts is safe to hand to
   * `Intl.DateTimeFormat`. Asserting it directly means the two can never
   * drift — a laxer check here would fail this test, not production.
   */
  it("accepts exactly what Intl accepts", async () => {
    const { isValidTimeZone } = await import("@/lib/timezone");
    for (const tz of [
      "UTC",
      "America/Argentina/Buenos_Aires",
      "Asia/Tokyo",
      "Europe/Oslo",
      "Marte/Olympus_Mons",
      "GMT-3",
      "",
    ]) {
      let intlAccepts = true;
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
      } catch {
        intlAccepts = false;
      }
      expect(isValidTimeZone(tz), `mismatch for "${tz}"`).toBe(intlAccepts);
    }
  });
});
