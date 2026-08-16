import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { routing } from "@/i18n/routing";
import { loadCatalogues } from "./helpers/catalogues";

const CATALOGUES = loadCatalogues();

/**
 * Guardrail against handing raw SDK errors to the user (#199).
 *
 * Server actions redirect with `?error=<text>`, so whatever goes in that
 * argument lands in the user's URL — and in their browser history, and in
 * any referrer. The codebase leaked PostgREST and GoTrue messages there
 * two ways:
 *
 *   redirectWithError(target, error, locale)          // raw, loose
 *   redirectWithError(target, t("deleteFailed", { error }), locale)
 *
 * The second was the sneakier one: the sentence around it *is* translated,
 * so it reads as handled. Constraint names, column names and policy names
 * went out anyway — plus, on the auth routes, enough detail to tell "no
 * such user" from "wrong password".
 *
 * The raw detail now goes to `console.error` through `redirectWithError`'s
 * `cause` parameter, which is the whole point of it being a parameter:
 * the moment you drop the detail is the moment you have to log it.
 *
 * Same shape as the other source-scanning guardrails here — see
 * `no-host-header-urls.test.ts` for the reasoning about sanity checks and
 * comment stripping.
 */

const SRC = join(process.cwd(), "src");

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

/** Strips comments, so prose describing the old pattern isn't flagged. */
function code(file: string): string {
  return readFileSync(join(SRC, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Walks every string leaf of the message catalogue. */
function messageEntries(
  node: unknown,
  path: string[] = [],
): Array<[string, string]> {
  if (typeof node === "string") return [[path.join("."), node]];
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([k, v]) =>
      messageEntries(v, [...path, k]),
    );
  }
  return [];
}

describe("raw SDK errors never reach the user", () => {
  it("finds source files to scan (sanity check)", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("lib/redirects.ts");
  });

  it("no message interpolates a raw {error}", () => {
    const offenders = routing.locales
      .flatMap((locale) =>
        messageEntries(CATALOGUES[locale]).map(
          ([k, v]) => [`${locale}.${k}`, v] as const,
        ),
      )
      .filter(([, value]) => /\{\s*error\s*\}/.test(value));

    expect(
      offenders.map(([key]) => key),
      `These messages splice a raw SDK error into a translated sentence, which ` +
        `puts constraint and policy names in the user's URL. Show a clean ` +
        `sentence and pass the detail as redirectWithError's \`cause\` instead ` +
        `— see #199.`,
    ).toEqual([]);
  });

  it("no call site passes a raw error as the user-facing message", () => {
    // `redirectWithError(target, error, locale)` — second argument is the
    // text the user sees, so a bare `error` there is the raw SDK string.
    const bare = /redirectWithError\(\s*[^,]+,\s*error(\.message)?\s*,/;

    const offenders = sourceFiles().filter((f) => bare.test(code(f)));

    expect(
      offenders,
      `These pass an SDK error straight into the query string: ${offenders.join(", ")}. ` +
        `Use a translated key and pass the raw text as \`cause\` — see #199.`,
    ).toEqual([]);
  });

  it("the comment stripper doesn't blank files (sanity check)", () => {
    expect(code("lib/redirects.ts")).toContain("export function redirectWithError");
    expect(code("lib/actions/firearms.ts").length).toBeGreaterThan(500);
  });
});

describe("the auth actions do not confirm whether an account exists", () => {
  // GoTrue distinguishes "no such user" from "wrong password", and on
  // signup it says when an address is already registered. Putting either in
  // the URL is account enumeration served on request.
  it("login and signup send fixed messages, not error.message", () => {
    for (const file of [
      "app/[locale]/(auth)/login/actions.ts",
      "app/[locale]/(auth)/signup/actions.ts",
    ]) {
      const src = code(file);
      expect(src).not.toMatch(/redirectWithError\(\s*"[^"]+",\s*error\.message/);
      // And the detail still has to be logged rather than dropped.
      expect(src).toMatch(/detail:\s*error\.message/);
    }
  });
});
