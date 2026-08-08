import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { safeBackPath } from "@/lib/paths";

/**
 * The invariant behind the #218 fix, stated as a property.
 *
 * `/auth/callback` and `/auth/confirm` used to build their post-auth
 * redirect as `` `${origin}${next}` `` with `next` straight from the query
 * string. That is a string concatenation, not a URL operation, so a value
 * carrying `@` moved the host:
 *
 *     "https://our-host" + "@evil.example"  →  host evil.example
 *
 * The redirect fires *after* the session is established, and
 * `/auth/confirm` links arrive by email — so the victim is authenticated,
 * and the link they clicked genuinely is on our domain.
 *
 * Both handlers now do `new URL(safeBackPath(next, "/dashboard"), origin)`.
 * This reproduces that composition rather than the handlers themselves,
 * which would need a Supabase session to exercise. What it pins is the
 * only thing that matters: **no query-string value can move the host**.
 */

const ORIGIN = "https://hitfactor-sand.vercel.app";
const ORIGIN_HOST = "hitfactor-sand.vercel.app";

/** What the handlers do with a `next` value. */
function resolveRedirect(next: string | null): URL {
  return new URL(safeBackPath(next, "/dashboard"), ORIGIN);
}

describe("post-auth redirect cannot leave the origin", () => {
  const attacks = [
    // The one that actually escaped before the fix.
    "@evil.example",
    "@evil.example/phish",
    "@evil.example:443",
    // These never escaped — WHATWG URL parsing keeps them as paths — but
    // they're the obvious things to try, so they stay pinned.
    "//evil.example",
    "///evil.example",
    "\\evil.example",
    "\\\\evil.example",
    "https://evil.example",
    "http://evil.example",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    // Chained redirect: bounce through a route that itself takes a `next`.
    "/dashboard?next=@evil.example",
    "/dashboard#@evil.example",
  ];

  it.each(attacks)("%s stays on the origin", (next) => {
    expect(resolveRedirect(next).host).toBe(ORIGIN_HOST);
  });

  it("every attack falls back to /dashboard rather than half-applying", () => {
    // Landing on the origin is not enough on its own — a value that
    // survived as a weird path would also pass the check above.
    for (const next of attacks) {
      expect(resolveRedirect(next).pathname).toBe("/dashboard");
    }
  });

  it("demonstrates the escape the fix prevents", () => {
    // The old code, kept here so the reason for the whitelist is visible
    // rather than folkloric. If this ever stops holding, the URL parser
    // changed and the fix wants re-checking.
    expect(new URL(`${ORIGIN}@evil.example`).host).toBe("evil.example");
    // And with the whitelist in front of it:
    expect(resolveRedirect("@evil.example").host).toBe(ORIGIN_HOST);
  });
});

/**
 * The property tests above pin `safeBackPath` + `new URL`, not the routes.
 * On their own they'd stay green if somebody dropped the whitelist from a
 * handler, which is the regression worth catching — so check the source
 * too.
 */
describe("the auth handlers use the safe composition", () => {
  const ROUTES = ["callback", "confirm"] as const;

  function routeSource(route: string): string {
    return readFileSync(
      join(process.cwd(), "src/app/auth", route, "route.ts"),
      "utf8",
    );
  }

  /**
   * Strips comments before matching. Both handlers quote the old
   * `` `${origin}${next}` `` in their docs to explain what the whitelist
   * is defending against, and a naive scan flags that prose — which is how
   * this check first went red against a file that was already correct.
   * A guardrail that punishes documenting the bug is worse than none.
   */
  function code(route: string): string {
    return routeSource(route)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  it.each(ROUTES)("/auth/%s validates next and builds a real URL", (route) => {
    expect(code(route)).toMatch(/safeBackPath\(\s*searchParams\.get\("next"\)/);
    expect(code(route)).toMatch(/NextResponse\.redirect\(\s*new URL\(/);
  });

  it.each(ROUTES)("/auth/%s never concatenates onto the origin", (route) => {
    // `${origin}${...}` — the exact shape of the bug. A template literal
    // starting from `origin` is what let `@` move the host.
    expect(code(route)).not.toMatch(/`\$\{origin\}\$\{/);
  });

  it("the comment stripper doesn't blank the file (sanity check)", () => {
    // If the regexes above ever ate the whole source, every assertion in
    // this block would pass vacuously.
    for (const route of ROUTES) {
      expect(code(route)).toContain("NextResponse.redirect");
      expect(code(route).length).toBeGreaterThan(200);
    }
  });
});

describe("legitimate destinations still work", () => {
  const allowed = [
    ["/dashboard", "/dashboard"],
    ["/matches", "/matches"],
    ["/dashboard/tiro_fbi", "/dashboard/tiro_fbi"],
    ["/firearms/8f14e45f-ceea-467a-9f7c-1a2b3c4d5e6f", "/firearms/8f14e45f-ceea-467a-9f7c-1a2b3c4d5e6f"],
    ["/activity", "/activity"],
  ] as const;

  it.each(allowed)("%s resolves to itself on the origin", (next, expected) => {
    const url = resolveRedirect(next);
    expect(url.host).toBe(ORIGIN_HOST);
    expect(url.pathname).toBe(expected);
  });

  it("a missing next lands on the dashboard", () => {
    expect(resolveRedirect(null).pathname).toBe("/dashboard");
  });
});
