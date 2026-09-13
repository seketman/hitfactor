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
 * **Why this is a text check, and what that cost once.**
 * There is nothing here to execute: the artifact is Go template text destined
 * for a dashboard field, rendered by a mailer nobody in this repo can run. So
 * these assertions are textual by necessity.
 *
 * The first version stopped there, and shipped a template that would not
 * parse. The explanatory comment at the top of the file contained
 * `{{ if … }}` written to describe the branch below it — and Go parses
 * actions everywhere, with no idea that HTML calls that a comment. The
 * unclosed block broke the whole template, GoTrue sent nothing, and the
 * failure surfaced as an email that simply never arrived: no error, no
 * bounce, a dashboard that looked fine. A person signed up and waited.
 *
 * So the checks below include the two rules Go actually enforces and a text
 * scan can too — actions balance, and none of them hide inside a comment.
 * Assertions about the copy are still out of reach, and so is the thing most
 * likely to be wrong: whether the dashboard holds what this file says. That
 * stays with the two-part check in the directory's README.
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

/** Every `{{ … }}` action, wherever it sits — Go makes no exception. */
function actions(source = TEMPLATE): string[] {
  return [...source.matchAll(/\{\{[^}]*\}\}/g)].map((m) => m[0]);
}

/** The HTML comments, which Go does not treat as comments at all. */
function htmlComments(): string[] {
  return [...TEMPLATE.matchAll(/<!--[\s\S]*?-->/g)].map((m) => m[0]);
}

describe("the template still parses", () => {
  // These two are the rules Go enforces that broke this file once. Neither
  // needs a Go toolchain to check, which is the only reason the first version
  // of this suite had an excuse for missing them.

  it("hides no template action inside an HTML comment", () => {
    // The bug: `{{ if … }}` written in prose to explain the branch below it.
    // Go opened a block there and never found its end, the template failed to
    // parse, and the mailer sent nothing at all.
    //
    // Stricter than Go, and the reason is not the one first written here.
    // Go accepts a self-contained action in a comment — its own
    // `{{/* … */}}`, which opens no block — and carving that out would be a
    // single `startsWith`. It is absent because nobody needs a Go comment
    // inside an HTML comment, and a rule with no exceptions is easier to
    // obey than one with a footnote. Not because the distinction is hard.
    const buried = htmlComments().flatMap((c) => actions(c));
    expect(buried, "describe actions without braces — see the file header").toEqual([]);
  });

  it("balances every action that opens a block", () => {
    // All five of Go's block openers, and the trim markers all of them
    // accept. The first version of this counted only `if`, which fails both
    // ways once anything else appears: an unclosed `define` slips through
    // because its `end` is counted with nothing to match, and a *correct*
    // `define` fails because that same `end` has no opener. Neither sound nor
    // safe — a check that is wrong in both directions is worse than none,
    // because it teaches people to delete it.
    //
    // Balance, not a count. Pinning "exactly one `if`" would fail on a second
    // conditional somebody adds for a good reason.
    //
    // This is a hand-rolled approximation of a grammar, and it has already
    // been wrong twice. The real answer is to parse the file with Go, which
    // is how the original break was actually found — kept out of CI because
    // `ubuntu-latest` carries Go only in its toolcache, so it would mean a
    // `setup-go` step and a suite that cannot run without a Go toolchain. If
    // this rule is wrong a third time, pay that price instead of widening it
    // again.
    const OPENS = /^\{\{-?\s*(if|range|with|define|block)\b/;
    const ENDS = /^\{\{-?\s*end\s*-?\}\}$/;
    const opens = actions().filter((a) => OPENS.test(a)).length;
    const ends = actions().filter((a) => ENDS.test(a)).length;
    expect(opens).toBeGreaterThan(0);
    expect({ opens, ends }).toEqual({ opens, ends: opens });
  });
});

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
