import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardrail against building absolute URLs from request headers (#198).
 *
 * `Host` and `X-Forwarded-Host` are client input. The QR page derived the
 * URL it encoded from them, so a tampered header returned a page whose QR
 * pointed at another domain — and that QR gets **printed and stuck to a
 * firearm**, which is not something a deploy can revoke.
 *
 * The source of truth for absolute URLs is `NEXT_PUBLIC_SITE_URL` via
 * `absoluteUrl()` / `getSiteUrl()` (`src/lib/seo/site-url.ts`), which is
 * already what canonical, sitemap, robots, Open Graph and JSON-LD use.
 *
 * This is a text scan, not a type check: the point is that reintroducing
 * the pattern trips something, not that every possible spelling is caught.
 * Anything genuinely needing the request host goes in ALLOWLIST with the
 * issue that tracks it, so skipping the rule is a visible decision in the
 * diff rather than a quiet one.
 */

const SRC = join(process.cwd(), "src");

/**
 * Files allowed to read the host from the request, each with the issue
 * that covers it. This list should only ever shrink.
 */
const ALLOWLIST = new Map<string, string>([
  [
    "app/[locale]/(auth)/oauth.ts",
    "#219 — OAuth redirectTo. Fixing it means deciding what happens to " +
      "per-deploy preview logins, so it isn't a drop-in swap.",
  ],
]);

/** `headersList.get("host")`, `.get('x-forwarded-host')`, etc. */
const HOST_HEADER = /\.get\(\s*["'`](?:x-forwarded-host|x-forwarded-proto|host)["'`]\s*\)/i;

/**
 * Walks `src/` by hand rather than using `fs.globSync` or
 * `readdirSync(recursive: true)`. Both are newer than the Node the CI
 * runs (20, per `.github/workflows/ci.yml`) — `globSync` landed in 22 and
 * throws `TypeError: globSync is not a function` there, which is exactly
 * how this file first went red. `readdirSync` with `withFileTypes` has
 * been available forever.
 *
 * Paths come back relative to `src/` and slash-separated, so ALLOWLIST
 * keys read the same on every platform.
 */
function sourceFiles(dir = SRC, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...sourceFiles(join(dir, entry.name), rel));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out.sort();
}

describe("absolute URLs are not built from request headers", () => {
  it("finds source files to scan (sanity check)", () => {
    // Without this, a broken glob makes every assertion below vacuous.
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("lib/seo/site-url.ts");
  });

  it("no file outside the allowlist reads the host from headers", () => {
    const offenders = sourceFiles().filter((f) => {
      if (ALLOWLIST.has(f)) return false;
      return HOST_HEADER.test(readFileSync(join(SRC, f), "utf8"));
    });

    expect(
      offenders,
      `These files derive a host from request headers, which are client input. ` +
        `Use absoluteUrl() from @/lib/seo/site-url instead — see #198. If a file ` +
        `genuinely needs the request host, add it to ALLOWLIST with the issue ` +
        `covering it. Files: ${offenders.join(", ")}.`,
    ).toEqual([]);
  });

  it("the QR page uses the configured site URL (regression for #198)", () => {
    const qr = readFileSync(
      join(SRC, "app/[locale]/(app)/firearms/[id]/qr/page.tsx"),
      "utf8",
    );

    expect(qr).toMatch(/absoluteUrl\(`\/q\/\$\{firearm\.qr_code\}`\)/);
    expect(qr).not.toMatch(/next\/headers/);
  });

  it("every allowlisted file still exists", () => {
    // An allowlist entry outliving its file silently weakens the rule:
    // a future file at the same path would inherit the exemption.
    const files = new Set(sourceFiles());
    const stale = [...ALLOWLIST.keys()].filter((f) => !files.has(f));

    expect(
      stale,
      `ALLOWLIST references files that no longer exist: ${stale.join(", ")}. ` +
        `Remove the entries.`,
    ).toEqual([]);
  });
});
