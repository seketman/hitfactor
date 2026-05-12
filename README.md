# HitFactor

[![CI](https://github.com/seketman/hitfactor/actions/workflows/ci.yml/badge.svg)](https://github.com/seketman/hitfactor/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)

App para tiradores deportivos: importás los resultados de tus torneos
(PractiScore HTML para Tiro Práctico / Steel Challenge, CSV de Google Sheets
para Tiro FBI, PDF de WinMSS para IPSC), seguís tu evolución match a match
con KPIs y gráficos, y opcionalmente llevás el registro de las armas usadas
y los tiros disparados.

## Quickstart

```bash
npm install
cp .env.example .env.local           # completar con credenciales de Supabase
# aplicar TODAS las migraciones de supabase/migrations/ en el SQL Editor,
# en orden numérico (0001 → 0007).
npm run dev                          # http://localhost:3000
```

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Supabase (Postgres + Auth + RLS) ·
Tailwind 4 · Vitest.

## Comandos

| Comando | Descripción |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Build de producción |
| `npm test` | Tests (parsers, importer, stats, claim, estimador de tiros) |
| `npm run test:watch` | Tests en watch mode |

## Funcionalidades principales

- **Importación multi-formato**: HTML de PractiScore (IPSC + Steel Challenge) y
  CSV de Google Sheets para Tiro FBI. Detección automática de formato.
- **Multi-identidad por usuario**: el mismo tirador puede aparecer escrito
  distinto en cada disciplina ("Apellido, Nombre" en IPSC vs "Apellido Nombre"
  en FBI); el sistema soporta claimar varias identidades por usuario.
- **Auto-detección de claim**: al importar, sugiere los shooters que parecen
  ser el usuario logueado (matching por tokens del nombre + número de socio).
- **Dashboard con KPIs**: torneos disputados, promedio %, mejor %, mejor
  puesto, percentil promedio, consistencia (desvío estándar), tendencia
  (regresión lineal sobre todo el historial), cadencia (matches/mes).
- **Gráfico de evolución** SVG (sin librerías) con tooltip por match.
- **Catálogo de armas opcional**: registrá tus armas y asignalas por torneo
  para llevar el conteo de tiros (auto-derivado para FBI = 45 y Steel = 25 ×
  stages cargados; manual para IPSC).
- **Theming**: light / dark / system con persistencia (next-themes).

## Documentación

Documentación funcional en [`docs/`](./docs/README.md):

- [Setup local](./docs/development.md)
- [Arquitectura](./docs/architecture.md)
- [Modelo de datos](./docs/data-model.md)
- [Parsers](./docs/parsers.md)
- [Importación](./docs/importing.md)
- [Deployment](./docs/deployment.md)

## Estructura del proyecto

```
src/
├── app/                # rutas (route groups: (auth) y (app))
│   ├── (app)/
│   │   ├── dashboard/
│   │   ├── firearms/   # catálogo y detalle por arma
│   │   ├── import/
│   │   └── matches/
│   └── (auth)/         # login + signup
├── components/         # UI reutilizable + StatsOverview, PerformanceChart, etc.
├── lib/
│   ├── actions/        # Server Actions compartidos (claim, firearms)
│   ├── db/             # capa de acceso a datos (matches, shooters, firearms, ...)
│   ├── firearms/       # estimador de tiros por disciplina
│   ├── import/         # lógica de importación + auto-claim
│   ├── parsers/        # parsers de archivos externos (PractiScore, Steel, FBI CSV)
│   ├── stats/          # cómputo de KPIs (pure function, testeada)
│   ├── supabase/       # clientes server / browser / middleware
│   ├── types/          # tipos de dominio del parser
│   ├── disciplines.ts  # constantes + helpers de disciplinas
│   ├── redirects.ts    # helper redirectWithError
│   └── utils.ts        # cn, formatters
└── proxy.ts            # refresh de sesión por request

supabase/migrations/    # SQL del schema (numeradas 0001…0007)
docs/                   # documentación funcional
tests/                  # vitest + fixtures reales de PractiScore y FBI
```

## Schema (resumen)

- `profiles` · `disciplines` · `divisions` — base.
- `shooters` — identidades de tiradores (un usuario puede claimar varias).
- `matches` · `match_entries` · `stages` · `stage_results` — datos de torneos
  (compartidos entre usuarios; UNIQUE NULLS NOT DISTINCT en matches para
  evitar duplicados con region NULL).
- `firearms` · `match_firearm_log` — privados por usuario, RLS por owner.

Ver [`docs/data-model.md`](./docs/data-model.md) para el detalle.

## Contribuir

Pull Requests bienvenidos. Antes de mandar uno, leé [CONTRIBUTING.md](./CONTRIBUTING.md)
— tiene el setup local, las convenciones de commit (usamos
[conventional commits](https://www.conventionalcommits.org) para que
release-please calcule las versiones automáticamente), y el flujo de PR.

¿Encontraste un bug o tenés una idea?
[Abrí un issue](https://github.com/seketman/hitfactor/issues/new/choose).
Para bugs de importación de archivos, **adjuntá el archivo** que falla —
sin él no podemos reproducir.

## Licencia

[AGPL v3 o posterior](./LICENSE). En resumen: podés usar, modificar y
redistribuir el código libremente; si lo hostás como servicio público
(propio o forkeado), tu versión modificada también tiene que estar
disponible bajo AGPL. Esto preserva que las mejoras de la comunidad
queden abiertas para la comunidad.
