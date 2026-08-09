import { describe, expect, it } from "vitest";
import {
  SIDEBAR_COLLAPSED_COOKIE,
  parseSidebarCollapsed,
  serialiseSidebarCookie,
} from "@/lib/sidebar-preference";

/**
 * The sidebar's collapsed state moved from `localStorage` to a cookie so the
 * server can render the right DOM on the first paint (#209). That makes the
 * two ends of the cookie a contract: the server parses what the client
 * writes, and neither half is exercised by anything else.
 *
 * A cookie that fails to round-trip does not throw — it comes back
 * `undefined` on the next request and the sidebar quietly reopens, which is
 * the exact symptom the issue was about.
 */

describe("parseSidebarCollapsed", () => {
  it("treats only \"1\" as collapsed", () => {
    expect(parseSidebarCollapsed("1")).toBe(true);
    expect(parseSidebarCollapsed("0")).toBe(false);
  });

  /**
   * Expanded is the safe default: nothing is hidden in that state. A user
   * who never chose, or whose cookie got mangled, should get the full menu
   * rather than a strip of icons they have to decode.
   */
  it("falls back to expanded for anything else", () => {
    expect(parseSidebarCollapsed(undefined)).toBe(false);
    expect(parseSidebarCollapsed("")).toBe(false);
    expect(parseSidebarCollapsed("true")).toBe(false);
    expect(parseSidebarCollapsed("yes")).toBe(false);
  });
});

describe("serialiseSidebarCookie", () => {
  it("writes the value the parser reads back", () => {
    // The round trip is the point: asserting each half separately would let
    // the two drift into agreeing on nothing.
    for (const collapsed of [true, false]) {
      const value = serialiseSidebarCookie(collapsed)
        .split(";")[0]!
        .split("=")[1]!;
      expect(parseSidebarCollapsed(value)).toBe(collapsed);
    }
  });

  it("uses the name the server reads", () => {
    expect(serialiseSidebarCookie(true)).toMatch(
      new RegExp(`^${SIDEBAR_COLLAPSED_COOKIE}=`),
    );
  });

  /**
   * `path=/` because the sidebar is on every authenticated route: written
   * from `/matches` without it, the cookie scopes to that path and the
   * preference vanishes on the next page. `max-age` because a session
   * cookie would be gone the next morning, which is not what "remember the
   * sidebar" means.
   */
  it("scopes to the whole site and outlives the session", () => {
    const cookie = serialiseSidebarCookie(true);
    expect(cookie).toContain("path=/");
    expect(cookie).toMatch(/max-age=\d+/);
    expect(cookie).toContain("samesite=lax");

    const maxAge = Number(/max-age=(\d+)/.exec(cookie)![1]);
    expect(maxAge).toBeGreaterThanOrEqual(60 * 60 * 24 * 30);
  });
});
