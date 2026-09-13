# Auth email templates

Supabase Auth sends the transactional emails, not the app. The copy lives in
the dashboard under *Authentication → Email Templates*, and these files are
the record of what is supposed to be there.

**Committing one does not deploy it.** Same rule as `supabase/functions`, and
for the same reason that directory states it: `feedback-telegram` ran in
production for two months before anyone noticed it was not in the repository.
A file here that nobody pasted is a file that lies.

## Why one template and not three

Supabase renders one template per email type for the whole project — there is
no per-language variant to select. What it does give is Go templating over
`{{ .Data }}`, which is `auth.users.user_metadata`, so one template can branch
on a language the account recorded for itself. That is the approach Supabase
documents for this, and it is what `confirm-signup.html` does.

The language gets there from `signUp`:

```ts
options: { data: { display_name: displayName, locale } }
```

in `src/app/[locale]/(auth)/signup/actions.ts`. It is written once, at signup,
because that is the only moment Supabase's sender and the user's language are
in the same place.

## Why this copy is not in `messages/`

`AGENTS.md` says user-facing copy belongs in `messages/es.json` and friends,
never hardcoded. This is the one place that cannot hold: the app never renders
this text. Supabase does, on its own servers, from a field in its dashboard.
There is no request, no `next-intl`, and no moment at which a catalogue could
be consulted.

The alternative worth naming, because it is the first thing that comes to
mind: keep the three strings in the catalogues and generate this file from
them, so there is one source of truth. It was rejected on cost — a build step,
a generator and a check that the generated file matches, all for three short
paragraphs, and ending in a file that still has to be pasted into a dashboard
by hand. If this grows to several emails it stops being a bad idea.

What that costs is real and worth stating plainly: **these three translations
can drift from the app's tone and nothing will notice.** The parity test
covers `messages/`, not this. `tests/auth-email-template.test.ts` only checks
that a branch exists per locale, never what it says.

## Applying it

1. Copy `confirm-signup.html` into *Authentication → Email Templates → Confirm
   signup → Message body*.
2. Check the **subject**. The body is templated; whether the subject field
   accepts the same `{{ if }}` is not documented, and nobody here has tried it.
   If it does, branch it the same way. If it does not, leave a subject that
   reads acceptably in any of the three — the body is where the language
   actually matters.
3. Confirm the link still points at `/auth/confirm`, not at Supabase's own
   `/auth/v1/verify`. `src/app/auth/confirm/route.ts` explains what breaks
   otherwise, and it is not obvious: the wrong one confirms the email without
   setting cookies on our domain, so a browser already holding a session lands
   logged in as the previous user.

## Checking it

Sign up in each language and read what arrives. Three things, and the third is
the one that gets skipped:

- The email is in the language you signed up in.
- The link works and lands on `/<locale>/dashboard` — the locale prefix is the
  half this template carries, and it is the half that silently reverts to
  Spanish if `&locale=` is dropped from the URL.
- **Signing up in Spanish still works.** The Spanish copy is the final
  `{{ else }}`, so a broken branch above it fails *into* Spanish and looks
  perfectly healthy. Every account created before #151, and every Google
  signup, arrives through that branch too.

`tests/auth-email-template.test.ts` checks that the template has a branch for
every locale in `routing.locales`, so adding a fourth language fails there
rather than silently sending it Spanish. It also checks two rules Go enforces
that a text scan can reach — one of which this file broke, the other its near
neighbour. See below. What no test can check is whether the dashboard holds
what this file says.

## The failure this file already had

The first version did not parse, and nothing here noticed.

The explanatory comment at the top contained `{{ if … }}`, written to describe
the branch below it. **Go parses actions everywhere and does not care that
HTML calls that a comment.** The unclosed block broke the whole template.

What that looked like from outside is the part worth remembering: a signup
happened, no email arrived, no error appeared anywhere, and the dashboard
looked perfectly fine. The same shape as #288 — the failure that reports
nothing is the expensive one.

Two consequences, both now enforced by the test file:

- **No template braces in the comment.** Describe a branch as `the eq
  .Data.locale branch`, never in its braced form.
- **Block actions must balance** across the whole file, comments included —
  all five of `if`, `range`, `with`, `define` and `block`, in both their plain
  and trim-marker forms.

The second rule is a hand-rolled approximation of Go's grammar, and it has
been wrong twice: first by counting only `if`, which let an unclosed `define`
through *and* rejected a correct one. Parsing the file with `html/template`
and executing it against a sample `.Data` beats every assertion here — it is
how the original break was found, after it had already shipped — but it stays
out of CI because `ubuntu-latest` carries Go only in its toolcache, so it
would mean a `setup-go` step and a suite that cannot run without a Go
toolchain. **If the rule is wrong a third time, pay that price rather than
widen it again.**
