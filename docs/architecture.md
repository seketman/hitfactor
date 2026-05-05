# Arquitectura

## Stack

- **Framework**: Next.js 16 (App Router, Turbopack, React 19)
- **Lenguaje**: TypeScript estricto
- **DB + Auth + Storage**: Supabase (Postgres + RLS)
- **Estilos**: Tailwind CSS 4 con design tokens propios
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
│   │   ├── import/
│   │   └── matches/[id]/
│   ├── auth/                     # Endpoints OAuth y signout
│   │   ├── callback/route.ts
│   │   └── signout/route.ts
│   ├── layout.tsx                # Root: fonts, html lang
│   ├── page.tsx                  # Redirige según auth
│   └── globals.css               # Design tokens
│
├── components/                   # UI reutilizable
│   ├── ui/                       # Atómicos: Button, Card, Table, Badge, Alert, Input
│   └── layout/                   # AppHeader, AuthLayout, PageContainer
│
├── lib/
│   ├── db/                       # Capa de acceso a datos (queries)
│   │   ├── matches.ts
│   │   ├── shooters.ts
│   │   ├── profiles.ts
│   │   └── types.ts              # Tipos compartidos de DB
│   ├── import/                   # Lógica de importación
│   │   └── import-match.ts
│   ├── parsers/                  # Parsers de archivos externos
│   │   └── practiscore.ts
│   ├── supabase/                 # Clientes (browser, server, proxy)
│   ├── types/                    # Tipos de dominio (parser output)
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

### 3. Parser separado del importer

- `lib/parsers/practiscore.ts` → función pura: HTML → `ParsedMatch`. Sin DB.
- `lib/import/import-match.ts` → recibe un `ParsedMatch` + `SupabaseClient` y
  hace upserts. Sin DOM ni HTML.

Esto permite testear el parser contra fixtures, y el importer con un mock de
Supabase, sin necesidad de DB real para tests.

### 4. Server Actions para mutaciones

- `login`, `signup`, `importHtml`, `claimShooter`, `deleteMatch` son Server
  Actions (no API routes).
- Toman `FormData` y redirigen con query params para feedback.
- Errores de negocio se modelan con la clase `ImportError` (con `code`).

### 5. Design tokens en CSS variables

`globals.css` define variables CSS (`--bg`, `--surface`, `--accent`, ...) y las
expone al sistema de Tailwind 4 con `@theme inline`. Esto permite usar
`bg-bg`, `text-fg`, `border-border` en JSX y mantener una paleta coherente.

## Naming

- **shooter**: persona que aparece en resultados (puede ser usuario registrado o no).
- **profile**: perfil del usuario logueado (extiende `auth.users`).
- **match_entry**: resultado de un tirador en un match (overall).
- **stage_result**: resultado de un tirador en un stage individual.
- **claim**: vincular un `shooter` a un `auth.users.id`.
- **import**: subir un archivo HTML/PDF de PractiScore para crear o ampliar un match.
