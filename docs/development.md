# Local development

## Requirements

- Node 20+ (tested with 25)
- npm 11+
- A Supabase account (the free tier is enough)

## Initial setup

```bash
git clone <repo>
cd HitFactor
npm install
cp .env.example .env.local
# edit .env.local with your Supabase credentials
```

Variables expected in `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### `NEXT_PUBLIC_SITE_URL`

The absolute URL of the site. It is the source of truth for all SEO metadata:
canonical, sitemap, robots, Open Graph and JSON-LD. If it is not defined, the
local default is `http://localhost:3000`.

On Vercel it is set per environment (Production / Preview / Development) with
each one's real domain — that way the canonical URL and previews point to the
right host on every deploy.

## Setting up the database

Apply **all** the migrations in Supabase, in numeric order:

1. Open the project's SQL Editor.
2. Paste and run the files in order:

> 0001 is a **squash of the history prior to May 2026**, not a full bootstrap.
> After consolidating it the numbering started over, so 0002+ come after it
> and are still required: without them you have no `is_absent`, `min_shots`,
> `qr_code`, `is_admin`, the ammunition and firearm usage tables, or the
> Storage bucket for imports. Run **all** of them, in order.

| # | File | What it does |
|---|---|---|
| 0001 | [`0001_initial_schema.sql`](../supabase/migrations/0001_initial_schema.sql) | Consolidated base schema: profiles, disciplines, divisions, shooters, matches, stages, match_entries, stage_results, firearms, match_firearm_log, clubs, audit_log, feedback + indexes, triggers, RLS and seeds |
| 0002 | [`0002_my_discipline_counts.sql`](../supabase/migrations/0002_my_discipline_counts.sql) | `my_discipline_counts(p_user_id)` RPC — aggregates the user's participation count per discipline in Postgres (consumed by the sidebar) |
| 0003 | [`0003_security_advisor_fixes.sql`](../supabase/migrations/0003_security_advisor_fixes.sql) | Supabase Security Advisor fixes: fixed `search_path` on functions and the remaining linter warnings |
| 0004 | [`0004_fat_pdf_source.sql`](../supabase/migrations/0004_fat_pdf_source.sql) | Extends the `matches.source_type` CHECK with `fat_pdf` (official FAT rankings in PDF) |
| 0005 | [`0005_profiles_admin.sql`](../supabase/migrations/0005_profiles_admin.sql) | `profiles.is_admin` — enables the diagnostic views restricted to administrators |
| 0006 | [`0006_match_dedup_utilities.sql`](../supabase/migrations/0006_match_dedup_utilities.sql) | Audit and cleanup utilities for entries duplicated by re-import (`merge_duplicate_shooters` and friends) |
| 0007 | [`0007_match_entries_absent.sql`](../supabase/migrations/0007_match_entries_absent.sql) | `match_entries.is_absent` — distinguishes "did not compete" from "competed and did poorly" |
| 0008 | [`0008_match_entries_update_extended.sql`](../supabase/migrations/0008_match_entries_update_extended.sql) | Widens the UPDATE RLS on `match_entries`: besides the importer, admins and the shooter themselves |
| 0009 | [`0009_backfill_is_absent.sql`](../supabase/migrations/0009_backfill_is_absent.sql) | Backfills `is_absent` on matches imported before 0007 (avoids re-importing) |
| 0010 | [`0010_ammunition_types.sql`](../supabase/migrations/0010_ammunition_types.sql) | Per-shooter ammunition catalog, factory and reload (#46) |
| 0011 | [`0011_firearm_usage_log.sql`](../supabase/migrations/0011_firearm_usage_log.sql) | Firearm usage log outside matches — training and practice (#47) |
| 0012 | [`0012_firearm_qr_codes.sql`](../supabase/migrations/0012_firearm_qr_codes.sql) | Short code per firearm + `/q/{code}` route, so the QR stuck on the firearm stays small (#58) |
| 0013 | [`0013_firearm_qr_code_default.sql`](../supabase/migrations/0013_firearm_qr_code_default.sql) | Replaces the trigger that generated `qr_code` with a column DEFAULT, so `gen types` sees it as optional |
| 0014 | [`0014_match_min_shots.sql`](../supabase/migrations/0014_match_min_shots.sql) | `matches.min_shots` — the basis of the "extra rounds" KPI against `rounds_fired` (#75) |
| 0015 | [`0015_steel_pdf_source.sql`](../supabase/migrations/0015_steel_pdf_source.sql) | Extends the `source_type` CHECK with `practiscore_steel_pdf` (Steel Challenge PDFs) |
| 0016 | [`0016_fbi_classic_division.sql`](../supabase/migrations/0016_fbi_classic_division.sql) | `CLASSIC` division for Tiro FBI |
| 0017 | [`0017_ipsc_classic_manual_division.sql`](../supabase/migrations/0017_ipsc_classic_manual_division.sql) | `CM` (Classic Manual) division for IPSC — shotgun exported from PractiScore |
| 0018 | [`0018_update_ui_prefs_rpc.sql`](../supabase/migrations/0018_update_ui_prefs_rpc.sql) | `update_ui_prefs` RPC — atomic merge of `ui_prefs`, avoids lost updates (#126) |
| 0019 | [`0019_fbi_optic_division.sql`](../supabase/migrations/0019_fbi_optic_division.sql) | `OPTIC` division for Tiro FBI |
| 0020 | [`0020_import_uploads_storage.sql`](../supabase/migrations/0020_import_uploads_storage.sql) | Private `match-imports` bucket + per-user RLS policies, for staging import files |
| 0021 | [`0021_fix_shooters_claim_rls.sql`](../supabase/migrations/0021_fix_shooters_claim_rls.sql) | Fixes the UPDATE RLS on `shooters`: its `using` clause let any authenticated user edit or unlink someone else's shooter (#195) |
| 0022 | [`0022_matches_delete_admin.sql`](../supabase/migrations/0022_matches_delete_admin.sql) | `matches_delete_admin` — completes the admin scope over matches that 0014 started, so admin authority matches what the app offers (#197) |
| 0023 | [`0023_rls_to_clause_and_initplan.sql`](../supabase/migrations/0023_rls_to_clause_and_initplan.sql) | Rewrites every pre-0021 policy to `to authenticated` + `(select auth.uid())` — drops the deprecated `auth.role()` and clears the `auth_rls_initplan` advisory. No predicate changes (#207) |
| 0024 | [`0024_steel_rfri_division.sql`](../supabase/migrations/0024_steel_rfri_division.sql) | `RFRI` (rimfire rifle, labelled Minirifle) for Steel Challenge — the division was missing, so any match running it failed to import |

If you add a migration, add its row here: there is a test
(`tests/migrations-doc.test.ts`) that fails if the directory and this table
drift apart. This table was 18 migrations out of date precisely because
nothing verified it.

For development we recommend **disabling email confirmation** in Supabase →
*Authentication → Sign In / Providers → Email* — that way you can create test
accounts without having to confirm them.

## Commands

```bash
npm run dev          # dev server (localhost:3000)
npm run build        # production build
npm run lint         # eslint (errors fail, warnings are printed)
npm test             # run the tests once
npm run test:watch   # tests in watch mode
npm run db:types     # regenerate src/lib/supabase/database.types.ts from the DB
```

`db:types` needs a `SUPABASE_ACCESS_TOKEN` in the environment (or a prior
`supabase login`). Run it after applying a migration that changes the schema,
so the typed Supabase client stays in sync.

## Project structure

See [`architecture.md`](./architecture.md).

## Quick check after making changes

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```

All four have to pass. Currently: 832 tests green, typecheck clean, lint
clean (with the three warnings explained in `eslint.config.mjs`).

Note that `npx tsc --noEmit` and `npm run build` are **not** interchangeable.
`next build` also type-checks against the route types Next generates from the
directory structure (`PageProps<...>`, `LayoutProps<...>`), which plain `tsc`
never sees. A `params` type that satisfies `tsc` can still fail the build.
