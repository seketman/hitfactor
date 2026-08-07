<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Write in English

Anything you write or edit goes in English: **issue titles and bodies**, PR
titles and bodies, review comments, commit messages, code, identifiers, code
comments, and docs. This holds regardless of the language the maintainer is
talking to you in — the conversation is not the artifact.

One narrow exception: user-facing copy belongs in `messages/es.json` /
`messages/en.json`, never hardcoded. Keys must exist in both locales
(`tests/messages-parity.test.ts`).

## The repo is mid-migration

Much of `src/` and migrations `0001`-`0020` still carry Spanish comments, and
they are **not** being translated in bulk. The rule is incremental:

- A comment you write → English.
- A comment you edit → rewrite it in English.
- A comment you don't touch → leave it in Spanish.

Do not translate comments as a side effect of an unrelated change, and do not
copy the surrounding Spanish into something you're adding. Files will hold both
languages for a while; that's expected, not a defect to fix.

See `.github/CONTRIBUTING.md` for the full statement.
