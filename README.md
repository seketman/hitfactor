# HitFactor

[![CI](https://github.com/seketman/hitfactor/actions/workflows/ci.yml/badge.svg)](https://github.com/seketman/hitfactor/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)

An app for practical shooters: import your match results (PractiScore HTML and
PDF for IPSC / Steel Challenge, Google Sheets CSV for Tiro FBI, WinMSS and FAT
PDF for IPSC), track your progress match by match with KPIs and charts, and
optionally keep a log of the firearms you used and the rounds you fired.

## Quickstart

```bash
npm install
cp .env.example .env.local           # fill in your Supabase credentials
# apply ALL the migrations in supabase/migrations/ from the SQL Editor,
# in numeric order (0001 → 0020).
npm run dev                          # http://localhost:3000
```

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Supabase (Postgres + Auth + RLS) ·
Tailwind 4 · Vitest.

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm test` | Tests (parsers, importer, stats, claim, round estimator) |
| `npm run test:watch` | Tests in watch mode |

## Main features

- **Multi-format import**: PractiScore HTML (IPSC + Steel Challenge) and
  Google Sheets CSV for Tiro FBI. Format is detected automatically.
- **Multiple identities per user**: the same shooter may be spelled
  differently in each discipline ("Last, First" in IPSC vs "Last First" in
  Tiro FBI); a user can claim several identities.
- **Claim auto-detection**: on import, the app suggests the shooters that look
  like the logged-in user (matching on name tokens + member number).
- **Dashboard with KPIs**: matches shot, average %, best %, best placement,
  average percentile, consistency (standard deviation), trend (linear
  regression over the full history), cadence (matches/month).
- **Progress chart** in SVG (no libraries) with a per-match tooltip.
- **Optional firearm catalog**: register your firearms and assign them per
  match to keep a round count (auto-derived for Tiro FBI = 45 and Steel = 25 ×
  stages loaded; manual for IPSC).
- **Theming**: light / dark / system, persisted (next-themes).

## Documentation

Functional documentation lives in [`docs/`](./docs/README.md):

- [Local setup](./docs/development.md)
- [Architecture](./docs/architecture.md)
- [Data model](./docs/data-model.md)
- [Parsers](./docs/parsers.md)
- [Importing](./docs/importing.md)
- [Deployment](./docs/deployment.md)

## Project structure

```
src/
├── app/
│   ├── [locale]/       # localized routes (route groups: (app) and (auth))
│   │   ├── (app)/
│   │   │   ├── about/
│   │   │   ├── activity/
│   │   │   ├── ammo/
│   │   │   ├── dashboard/
│   │   │   ├── firearms/   # catalog and per-firearm detail
│   │   │   ├── import/
│   │   │   └── matches/
│   │   └── (auth)/     # login + signup
│   ├── auth/           # callback, confirm, signout (not localized)
│   └── q/[code]/       # short QR redirect per firearm
├── components/         # reusable UI + StatsOverview, PerformanceChart, etc.
├── lib/
│   ├── actions/        # shared Server Actions (claim, firearms)
│   ├── db/             # data access layer (matches, shooters, firearms, ...)
│   ├── firearms/       # per-discipline round estimator
│   ├── import/         # import logic + auto-claim
│   ├── parsers/        # external file parsers (PractiScore HTML/PDF, WinMSS, FAT, Steel, FBI CSV)
│   ├── stats/          # KPI computation (pure function, tested)
│   ├── supabase/       # server / browser / middleware clients
│   ├── types/          # parser domain types
│   ├── disciplines.ts  # discipline constants + helpers
│   ├── redirects.ts    # redirectWithError helper
│   └── utils.ts        # cn, formatters
└── proxy.ts            # per-request session refresh

supabase/migrations/    # schema SQL (numbered 0001…0020)
docs/                   # functional documentation
tests/                  # vitest + real PractiScore and FBI fixtures
```

## Schema (summary)

- `profiles` · `disciplines` · `divisions` — foundation.
- `shooters` — shooter identities (a user can claim several).
- `matches` · `match_entries` · `stages` · `stage_results` — match data
  (shared across users; UNIQUE NULLS NOT DISTINCT on matches to avoid
  duplicates when region is NULL).
- `firearms` · `match_firearm_log` — private per user, RLS by owner.

See [`docs/data-model.md`](./docs/data-model.md) for the details.

## Contributing

Pull Requests are welcome. Before sending one, read
[CONTRIBUTING.md](./.github/CONTRIBUTING.md) — it covers local setup, our
commit conventions (we use
[conventional commits](https://www.conventionalcommits.org) so release-please
can compute versions automatically), and the PR flow.

Found a bug or have an idea?
[Open an issue](https://github.com/seketman/hitfactor/issues/new/choose).
For file import bugs, **attach the file** that fails — without it we can't
reproduce.

## License

[AGPL v3 or later](./LICENSE). In short: you can use, modify and redistribute
the code freely; if you host it as a public service (your own or a fork), your
modified version has to be available under the AGPL too. This keeps community
improvements open to the community.
