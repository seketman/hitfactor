# Contributing to HitFactor

Thanks for wanting to help! HitFactor is an open-source app for practical
shooters, and any contribution — bug reports, suggestions, code, translations,
docs — is welcome.

This document explains how to run the project locally, the conventions we
follow, and the Pull Request flow.

## Language

**Write in English anything you add to the repo or to GitHub**: issue titles and
bodies, PR titles and bodies, review comments, commit messages, code,
identifiers, code comments, and documentation. It applies to what you *write or
edit*, in whatever language the discussion around it happened.

The project is open source and the maintainer is an Argentinian Spanish
speaker, so the temptation to switch is real. The goal is that a contributor
who doesn't read Spanish can follow along — above all in **issues and pull
requests**, which is where the *why* of a change is argued out before it
becomes a commit, and which are the first thing a newcomer reads.

One thing is deliberately **not** covered: **user-facing copy**, which lives in
`messages/es.json` and `messages/en.json` and is translated for both locales.
Keys must exist in both — there is a test (`tests/messages-parity.test.ts`)
that fails otherwise.

### The repo is mid-migration, on purpose

Plenty of comments across `src/` and in migrations `0001`-`0020` are still in
Spanish, and **they are not being translated in bulk**. They get rewritten in
English when the code around them is worked on, and left alone otherwise.

So a file you touch may end up holding both languages for a while. That is the
accepted cost: the alternative is a 135-file diff that changes no behavior and
that nobody can review carefully. Don't translate comments you aren't otherwise
touching, and don't copy the surrounding Spanish into something you're adding.

Closed issues predating the rule stay in Spanish too — rewriting history adds
noise without helping anyone.

## Local setup

You'll need:

- Node.js 20+ and npm
- A [Supabase](https://supabase.com) account (the free tier is enough) — you'll
  need the project URL + anon key
- A client to run SQL migrations (Supabase's own SQL Editor works fine)

Steps:

```bash
git clone https://github.com/seketman/hitfactor.git
cd hitfactor
npm install
cp .env.example .env.local           # fill in your Supabase credentials
# apply ALL the migrations in supabase/migrations/ in numeric order
# from your Supabase project's SQL Editor
npm run dev                          # http://localhost:3000
```

More detail in [docs/development.md](../docs/development.md).

## Before sending the PR

Your PR has to pass CI, which runs:

```bash
npx tsc --noEmit       # type-check, no errors
npm test               # vitest, all tests green
npm run build          # production build works (in CI, not mandatory locally)
```

If your change touches business logic (parsers, importer, stats, claim),
please add or update the matching test in `tests/`. There are real fixtures for
PractiScore, FBI CSV and WinMSS PDF to reproduce cases.

## Commit conventions

We use **conventional commits** because
[release-please](https://github.com/googleapis/release-please) reads them to
compute the next version and build the CHANGELOG automatically:

| Prefix | When to use it | Version effect |
|---|---|---|
| `feat:` | New user-visible functionality | minor (1.0.0 → 1.1.0) |
| `fix:` | Bugfix | patch (1.0.0 → 1.0.1) |
| `perf:` | Performance improvement with no API change | patch |
| `refactor:` | Internal refactor with no behavior change | patch |
| `docs:` | Documentation only | patch |
| `chore:` / `test:` / `style:` / `ci:` / `build:` | Maintenance, tests, formatting, CI, build | no bump |
| `feat!:` or `BREAKING CHANGE:` in the body | Incompatible change | major (1.0.0 → 2.0.0) |

Example:

```
feat(import): support WinMSS PDF format with by-stage layout

Adds parser for the ESS "Results by Stage" PDF variant used by some
clubs (TFABA Quilmes etc). The header is "<Division> - Results by Stage"
followed by a "Stage <Division> - Stage NN" subheader, and rows are
5-column (place, %, points, bib, name) — no raw hits/time/factor.
```

## Pull Request flow

1. **Fork** the repo from GitHub.
2. **Branch off `main`** with a descriptive name:
   `feat/winmss-by-stage-parser`, `fix/duplicate-shooters-on-reupload`, etc.
3. **Commit with conventional commits** (see above). Three small, atomic
   commits beat one giant commit.
4. **Run the checks locally** before pushing (`tsc`, tests, optionally
   `npm run build`).
5. **Open the PR against `main`** on the original repo. Fill in the template —
   especially the "test plan", so it's clear what you tested.
6. **Wait for review**. There is only one maintainer for now, so it may take a
   few days. If changes are requested, apply them in additional commits (don't
   force-push the branch — preserving the history helps reviewing).
7. **Squash & merge** is done by me from GitHub on approval — you don't have to
   reorganize anything.

## Reporting bugs

Open an [issue](https://github.com/seketman/hitfactor/issues/new/choose) with
the bug template. Include:

- The version you're running (it's at the bottom of the sidebar, e.g. `v1.2.0`)
- Steps to reproduce
- What you expected vs what happened
- If an import is broken, **attach the file** (PDF / HTML / CSV) that fails —
  without it we can't reproduce

## Suggesting features

Same place, feature request template. Before investing time coding something
big, open the issue first to discuss it — it saves rework on both sides.

## License

By contributing you accept that your code is distributed under
[AGPL v3 or later](../LICENSE), the same license as the project. In
particular: if someone hosts HitFactor (or a fork) as a public service, they
are required to publish the source code — including yours.

## Code of conduct

Treat the community the way you'd like to be treated. Discriminatory comments,
harassment, or personal attacks are moderated without warning. If you need to
report something, send me a private email (you'll find it on my GitHub
profile).
