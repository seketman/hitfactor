# Arquitectura

## Stack

- **Framework**: Next.js 16 (App Router, Turbopack, React 19)
- **Lenguaje**: TypeScript estricto
- **DB + Auth**: Supabase (Postgres + RLS)
- **Estilos**: Tailwind CSS 4 con design tokens propios
- **Theming**: next-themes (light / dark / system)
- **Tests**: Vitest

## Estructura de carpetas

```
src/
├── app/                          # Rutas (Next.js App Router)
│   ├── (auth)/                   # Group: rutas para usuarios sin sesión
│   │   ├── layout.tsx            # Redirige al dashboard si ya hay sesión
│   │   ├── login/
│   │   └── signup/
│   ├── (app)/                    # Group: rutas protegidas
│   │   ├── layout.tsx            # Auth gate + AppHeader
│   │   ├── dashboard/
│   │   ├── firearms/             # Catálogo + detalle por arma
│   │   ├── import/
│   │   └── matches/[id]/
│   ├── auth/                     # Endpoints OAuth y signout
│   │   ├── callback/route.ts
│   │   └── signout/route.ts
│   ├── layout.tsx                # Root: fonts, html lang, ThemeProvider
│   ├── page.tsx                  # Redirige según auth
│   └── globals.css               # Design tokens light + dark
│
├── components/                   # UI reutilizable
│   ├── ui/                       # Atómicos: Button, Card, Table, Badge, Alert, Input, Select, ThemeToggle
│   ├── layout/                   # AppHeader, AuthLayout, PageContainer
│   ├── providers/                # ThemeProvider (next-themes)
│   ├── HistoryTable.tsx          # Tabla con filtros/sort del historial
│   ├── StatsOverview.tsx         # KPIs + breakdown por disciplina
│   ├── PerformanceChart.tsx      # Gráfico SVG de evolución
│   └── FirearmSelector.tsx       # Form para asignar arma a un match
│
├── lib/
│   ├── actions/                  # Server Actions compartidos
│   │   ├── claim.ts              # claimShooter / unclaimShooter
│   │   └── firearms.ts           # CRUD + setMatchFirearm
│   ├── db/                       # Capa de acceso a datos (queries)
│   │   ├── matches.ts
│   │   ├── shooters.ts
│   │   ├── profiles.ts
│   │   ├── firearms.ts
│   │   └── types.ts              # Tipos compartidos de DB
│   ├── firearms/
│   │   └── estimate-rounds.ts    # Pure function: pre-fill por disciplina
│   ├── import/
│   │   ├── import-match.ts       # Importer (parser-agnostic)
│   │   └── match-claim.ts        # Auto-detección de claim por nombre/socio
│   ├── parsers/                  # Parsers de archivos externos
│   │   ├── index.ts              # Dispatcher (HTML vs CSV)
│   │   ├── practiscore.ts        # IPSC (PractiScore HTML)
│   │   ├── steel-challenge.ts    # Steel Challenge (PractiScore HTML variante)
│   │   └── fbi-csv.ts            # Tiro FBI (CSV de Google Sheets)
│   ├── stats/
│   │   └── shooter-stats.ts      # Pure function: KPIs del dashboard
│   ├── supabase/                 # Clientes (browser, server, proxy)
│   ├── types/                    # Tipos de dominio (parser output)
│   ├── disciplines.ts            # Constantes + isTimeBasedDiscipline
│   ├── redirects.ts              # redirectWithError helper
│   ├── clubs.ts                  # Mapeo región ↔ código de club
│   └── utils.ts                  # cn(), formatters
│
└── proxy.ts                      # Refresh de sesión en cada request
```

## Decisiones de diseño

### 1. Route groups

`(auth)` y `(app)` agrupan rutas con un `layout.tsx` compartido:

- `(auth)/layout.tsx` redirige al dashboard si hay sesión.
- `(app)/layout.tsx` redirige a `/login` si no hay sesión y monta el `AppHeader`.

Las páginas hijas no tienen que repetir esa lógica.

### 2. Capa de acceso a datos (`src/lib/db/`)

Todas las queries a Supabase viven acá, no embebidas en las páginas.

- Las páginas son **componentes de presentación** que llaman funciones de `db/`.
- Los tipos de los rows están centralizados en `db/types.ts`.
- Cuando generemos types con `supabase gen types`, ese archivo se reemplaza.

### 3. Parsers separados del importer

- `lib/parsers/{practiscore,steel-challenge,fbi-csv}.ts` → funciones puras:
  contenido del archivo → `ParsedMatch`. Sin DB.
- `lib/parsers/index.ts` → dispatcher: detecta formato (HTML vs CSV) y delega.
- `lib/import/import-match.ts` → recibe un `ParsedMatch` + `SupabaseClient` y
  hace upserts. Sin DOM ni HTML.

Esto permite testear cada parser contra fixtures, y el importer con un mock de
Supabase, sin necesidad de DB real para tests.

### 4. Pure functions con tests para toda la lógica de dominio

- **Parsers** (`parsers/`): contenido → `ParsedMatch`.
- **Stats** (`stats/shooter-stats.ts`): entries → KPIs.
- **Estimador** (`firearms/estimate-rounds.ts`): disciplina → tiros estimados.
- **Claim** (`import/match-claim.ts`): comparación de nombres con tokens.

Cada uno se testea sin necesidad de DB ni de browser.

### 5. Server Actions para mutaciones

- `login`, `signup`, `importHtml`, `claimShooter`, `unclaimShooter`,
  `deleteMatch`, `createFirearm`, `updateFirearm`, `deleteFirearm`,
  `setMatchFirearm` son Server Actions (no API routes).
- Toman `FormData` y redirigen con query params para feedback.
- Errores de UI se manejan con `redirectWithError(path, message)`
  ([`src/lib/redirects.ts`](../src/lib/redirects.ts)) para no repetir
  `encodeURIComponent` en cada call site.
- Errores de negocio del importer se modelan con la clase `ImportError`
  (con `code`).

### 6. Disciplinas como single source of truth

[`src/lib/disciplines.ts`](../src/lib/disciplines.ts) define las constantes
(`DISCIPLINE.IPSC`, `STEEL`, `COMBAT`, `FBI`) y el helper
`isTimeBasedDiscipline()`. Los parsers y la UI consumen las constantes en vez
de magic strings, así una disciplina nueva se agrega tocando un solo archivo
+ la migración correspondiente.

### 7. Multi-identidad por usuario

Un mismo usuario puede tener varios `shooters` linkeados (uno por disciplina /
torneo) porque el nombre escrito varía: PractiScore usa "Apellido, Nombre"
mientras que la planilla FBI usa "Apellido Nombre". Las pantallas que
muestran "lo mío" agregan a través de **todos** los shooters linkeados
(`listMyShooters` + `listEntriesByShooters`).

### 8. Privacidad mixta

- **Datos comunitarios** (matches, match_entries, shooters, stages,
  stage_results, profiles): legibles entre todos los usuarios autenticados.
  Ver `docs/data-model.md`.
- **Datos privados** (firearms, match_firearm_log): RLS por `owner_user_id` /
  ownership encadenada. Solo los ve el dueño.

### 9. Design tokens en CSS variables

`globals.css` define variables CSS (`--bg`, `--surface`, `--accent`, ...) y las
expone al sistema de Tailwind 4 con `@theme inline`. Hay dos sets: `:root`
(light) y `.dark` (dark). `next-themes` togglea la clase del `<html>` con
soporte de `system` como default.

## Naming

- **shooter**: persona que aparece en resultados (puede ser usuario registrado o no).
- **profile**: perfil del usuario logueado (extiende `auth.users`).
- **identity**: cada `shooter` linkeado a un `auth.users.id`. Un user puede
  tener varias.
- **match_entry**: resultado de un tirador en un match (overall).
- **stage_result**: resultado de un tirador en un stage individual.
- **claim**: vincular un `shooter` a un `auth.users.id`.
- **import**: subir un archivo HTML/CSV de PractiScore/Sheets para crear o
  ampliar un match.
- **firearm**: arma del catálogo personal del usuario.
- **match_firearm_log**: vínculo entre un `match_entry` y un `firearm` con
  los tiros disparados.
