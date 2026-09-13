import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { routing } from "@/i18n/routing";

/**
 * Guards `supabase/templates/confirm-signup.html` against the locale list (#151).
 *
 * Supabase Auth sends the confirmation email, from one template per project,
 * with no idea who is reading it. The template branches on the `locale` the
 * account recorded at signup — the approach Supabase documents for this, since
 * there is no per-language variant to select.
 *
 * **Why this file is only a text check, and why that is not the usual mistake.**
 * `supabase/functions/README.md` records that scanning source as text was tried
 * for the Edge Function and did not work: a substring is not a scope, and
 * regressions walked straight through it. The difference here is that there is
 * nothing to execute. The artifact is Go template text destined for a dashboard
 * field, rendered by a mailer nobody here can run. So this checks the few
 * properties that are genuinely textual, and claims nothing else.
 *
 * What it cannot check at all is the thing most likely to be wrong: whether
 * the dashboard holds what this file says. That stays with the two-part check
 * in the directory's README.
 */

const TEMPLATE = readFileSync(
  join(process.cwd(), "supabase/templates/confirm-signup.html"),
  "utf8",
);

/**
 * The `href` of every link in the template.
 *
 * Matched between the quotes rather than by stopping at whitespace: Go
 * template syntax has spaces inside it (`{{ .TokenHash }}`), so a
 * whitespace-delimited match truncates the URL halfway through and every
 * assertion on it fails for a reason that has nothing to do with the link.
 */
function hrefs(): string[] {
  return [...TEMPLATE.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.trim());
}

/**
 * The locales the template branches on.
 *
 * The final `{{ else }}` is the default locale's branch and the fallback for
 * an account with no recorded language, so it counts as covering it.
 */
function branchedLocales(): Set<string> {
  const explicit = [...TEMPLATE.matchAll(/eq \.Data\.locale "([^"]+)"/g)].map(
    (m) => m[1]!,
  );
  const covered = new Set(explicit);
  if (/\{\{\s*else\s*\}\}/.test(TEMPLATE)) covered.add(routing.defaultLocale);
  return covered;
}

describe("the signup confirmation template", () => {
  it("has a branch for every locale the app serves", () => {
    // A fourth language added to `routing.locales` would otherwise be sent
    // Spanish, quietly, by the fallback branch — which is exactly the shape
    // of failure that looks like nothing is wrong.
    expect([...branchedLocales()].sort()).toEqual([...routing.locales].sort());
  });

  it("branches on no locale the app does not serve", () => {
    // The other direction: a branch left behind after a locale is dropped is
    // dead copy nobody will ever read, and nobody will notice.
    const unknown = [...branchedLocales()].filter(
      (l) => !(routing.locales as readonly string[]).includes(l),
    );
    expect(unknown).toEqual([]);
  });

  it("ends in a fallback rather than falling through to nothing", () => {
    // Without the final `{{ else }}`, an account with no recorded locale —
    // every signup before #151, and every Google signup — receives an email
    // with no body at all.
    expect(TEMPLATE).toMatch(/\{\{\s*else\s*\}\}/);
  });

  it("carries a literal locale on every confirmation link", () => {
    // `/auth/confirm` reads this to land the user in their own language.
    // Dropping it costs nothing visible: the link still works, and everybody
    // silently arrives in Spanish.
    //
    // A literal per branch, never `{{ .Data.locale }}`. `user_metadata` is
    // not ours alone — any authenticated user can overwrite their own with
    // `supabase.auth.updateUser({ data: … })`, bypassing `resolveLocale`
    // entirely — so it must not be interpolated back into an href. Inside a
    // branch that already tested the language, the variable added nothing.
    expect(hrefs().length).toBe(routing.locales.length);

    const carried = hrefs().map((h) => /[?&]locale=([^&"]*)/.exec(h)?.[1]);
    expect(carried.sort()).toEqual([...routing.locales].sort());

    for (const href of hrefs()) {
      expect(href, href).not.toContain(".Data.locale");
      expect(href, href).toContain("token_hash={{ .TokenHash }}");
    }
  });

  it("points every link at our own confirm route", () => {
    // `/auth/v1/verify` confirms the email without setting cookies on our
    // domain, so a browser already holding a session lands logged in as the
    // previous user. The header of `src/app/auth/confirm/route.ts` has it.
    //
    // Checked on the links rather than on the file: the comment at the top of
    // the template names that endpoint in order to warn about it, and the
    // first version of this test failed on that comment. A guard that trips
    // over the explanation of what it guards is not a guard.
    for (const href of hrefs()) {
      expect(href, href).not.toContain("/auth/v1/verify");
      expect(href, href).toContain("/auth/confirm?");
    }
  });
});
