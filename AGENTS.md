<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Write in English

Everything you write into the repo or into GitHub goes in English: **issue
titles and bodies**, PR titles and bodies, review comments, commit messages,
code, identifiers, code comments, and docs. This holds regardless of the
language the maintainer is talking to you in — the conversation is not the
artifact.

One narrow exception: user-facing copy belongs in `messages/es.json` /
`messages/en.json`, never hardcoded. Keys must exist in both locales
(`tests/messages-parity.test.ts`).

This includes comments in `supabase/migrations/`. Migrations `0001`-`0020`
predate the rule and are still Spanish — don't translate them as a side effect
of an unrelated change, and don't copy their language into a new file.

See `.github/CONTRIBUTING.md` for the full statement.
