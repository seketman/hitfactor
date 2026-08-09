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
   * Written expecting `-03:00` to be rejected; it is not. ES2024 made offset
   * identifiers valid time zones, so `Intl` accepts them and this passes them
   * through.
   *
   * Left as-is rather than tightened. Vercel's edge only ever sends IANA
   * names, so this is unreachable in production, and an offset still renders
   * a correct wall clock — it just cannot follow DST. Rejecting it would be
   * code guarding a case that does not arrive.
   */
  it("passes an offset identifier through (ES2024 made these valid)", async () => {
    const { getRequestTimeZone } = await import("@/lib/timezone");
    withHeader("-03:00");
    await expect(getRequestTimeZone()).resolves.toBe("-03:00");
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
