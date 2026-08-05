# HitFactor — documentation

## Canonical documents (current)

| Document | What it's for |
|---|---|
| [`system-overview.md`](./system-overview.md) | **Snapshot of the whole system** (as of 2026-05-29, post-migration 0014). The decisions the app enables, navigation map, typical journeys, stack, architecture, data model, business rules and importing. This is the first doc to read to understand the current state. |
| [`glossary.md`](./glossary.md) | Domain terms (shooter, match, claim, hit factor, etc.). Required reading before writing a new spec or plan. |
| [`development.md`](./development.md) | How to run the project locally. Environment variables. Migrations. |
| [`deployment.md`](./deployment.md) | How to deploy to Vercel + Supabase. |
| [`importing.md`](./importing.md) | Import business rules, supported formats, how the file reaches the server, and error codes. |

## Other documents

| Document | Status |
|---|---|
| [`../.specify/memory/constitution.md`](../.specify/memory/constitution.md) | **Non-negotiable principles** every feature respects. Every new spec/plan checks them explicitly. |
| [`../specs/`](../specs/) | Feature specs (SDD format: `spec.md` + `plan.md` + `tasks.md` per feature). |

## Legacy documents (v0)

These files were written at launch (v0, 2026-05-05) and **were not kept up to
date** as the product evolved. Their content is covered, updated and expanded
in [`system-overview.md`](./system-overview.md). They are kept for historical
reference and will be removed once the team confirms no unique details are
lost.

They are still in Spanish: translating documents that are slated for deletion
would be wasted work. If any of them is promoted back to canonical, translate
it at that point.

| Legacy document | Replaced by |
|---|---|
| [`architecture.md`](./architecture.md) | [`system-overview.md`](./system-overview.md) §4 (Stack) and §5 (Architecture) |
| [`data-model.md`](./data-model.md) | [`system-overview.md`](./system-overview.md) §6 (Data model) |
| [`parsers.md`](./parsers.md) | [`system-overview.md`](./system-overview.md) §8.3 to §8.4 |
