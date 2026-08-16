import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The proxy matcher decides which requests get locale-prefixed. Getting it
 * wrong **fails quietly**: an unlisted route handler is redirected to
 * `/<locale>/<path>`, which does not exist, and answers 404.
 *
 * That is how `/api/health` shipped broken through a green suite, a clean
 * type-check and a successful build — it was only caught by curling it.
 * Nothing about a regex inside a config object is exercised by any of
 * those, so this file exercises it directly.
 *
 * **Read from source rather than imported.** Importing `@/proxy` pulls in
 * next-intl's middleware, which needs `next/server` and does not resolve
 * under vitest. Moving the pattern into its own module would be the
 * tidier fix, but Next requires `config` to be statically analysable in
 * the proxy file itself, so hoisting it risks the build — a worse trade
 * than a text scan. Same approach as `no-host-header-urls.test.ts`.
 */

const PROXY_SRC = readFileSync(
  join(process.cwd(), "src", "proxy.ts"),
  "utf8",
);

/**
 * The quoted string inside `matcher: [ ... ]`. `[\s\S]` rather than the `s`
 * flag: the tsconfig target predates it.
 */
const PATTERN = /matcher:[\s\S]*?"((?:[^"\\]|\\.)+)"/.exec(PROXY_SRC)?.[1];

const matcher = new RegExp(`^${PATTERN?.replace(/\\\\/g, "\\")}$`);

/**
 * Route handlers own their responses and must reach the app untouched.
 * Every one of these corresponds to a real file under `src/app`.
 */
const MUST_NOT_MATCH = [
  "/api/health", // the uptime probe (#225)
  "/auth/callback",
  "/auth/confirm",
  "/auth/signout",
  "/q/ABC123", // QR shortlink, scanned while logged out
];

/** Static assets and Next internals: prefixing them would 404 too. */
const ALSO_MUST_NOT_MATCH = [
  "/_next/static/chunk.js",
  "/_vercel/insights/script.js",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",
  "/opengraph-image",
  // The per-locale metadata routes (#275). The manifest is a Route Handler
  // and owns its response; it is excluded by the extension rule rather than
  // by name, which is why it is listed here and not above.
  "/es/manifest.webmanifest",
  "/en/manifest.webmanifest",
  "/apple-icon",
  "/icon",
];

/** Real pages, which do need the locale prefix — the rule's actual job. */
const MUST_MATCH = [
  "/",
  "/dashboard",
  "/dashboard/ipsc",
  "/matches",
  "/matches/8f14e45f-ceea-467a-9f9a-6f0a5b0f5f5f",
  "/firearms",
  "/import",
  "/login",
  "/es/dashboard",
  "/en/matches",
  // The generated OG image moved under `[locale]`, so its URL gained the
  // prefix and no longer hits the root `opengraph-image` exclusion. It is
  // expected to pass through the proxy untouched — next-intl sees a valid
  // prefix and leaves it alone. Verified by request, not by reading: this
  // exact class of change is what shipped `/api/health` broken.
  "/es/opengraph-image/og",
];

describe("proxy matcher", () => {
  /**
   * Without this every assertion below is vacuous: a failed extraction
   * gives `undefined`, and `^undefined$` matches nothing, so all the
   * "must not match" cases pass while proving nothing at all.
   */
  it("extracts the pattern from the source (sanity check)", () => {
    expect(PATTERN, "could not find the matcher string in src/proxy.ts")
      .toBeDefined();
    expect(PATTERN).toContain("_next");
    // And it really is a rule that discriminates, not one that rejects all.
    expect(matcher.test("/dashboard")).toBe(true);
    expect(matcher.test("/_next/x.js")).toBe(false);
  });

  it.each(MUST_NOT_MATCH)("leaves the route handler %s alone", (path) => {
    expect(
      matcher.test(path),
      `${path} would be redirected to /<locale>${path}, which does not ` +
        `exist — the request 404s instead of reaching its handler.`,
    ).toBe(false);
  });

  it.each(ALSO_MUST_NOT_MATCH)("leaves %s alone", (path) => {
    expect(matcher.test(path)).toBe(false);
  });

  it.each(MUST_MATCH)("still localises %s", (path) => {
    expect(
      matcher.test(path),
      `${path} is a page and needs the locale prefix. An exclusion that is ` +
        `too broad silently disables i18n routing for it.`,
    ).toBe(true);
  });

  /**
   * Each exclusion is anchored to a whole path segment. It was not always:
   * the list matched by **prefix**, so `q` swallowed `/quiz`, `auth`
   * swallowed `/authors` and `icon` swallowed `/iconography` — all of them
   * silently unlocalised. No such route exists today, which is why it was
   * never noticed; creating one would have broken its i18n with no symptom
   * pointing at the matcher. Adding `api` was about to extend the trap to
   * `/apiary`.
   */
  it.each(["/apiary", "/authors", "/quiz", "/iconography", "/apple-pie"])(
    "still localises %s, which only starts like an exclusion",
    (path) => {
      expect(matcher.test(path)).toBe(true);
    },
  );
});
