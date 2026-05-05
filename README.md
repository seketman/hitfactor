# HitFactor

App para tiradores deportivos: importás los HTMLs de PractiScore (Tiro
Práctico, y próximamente Steel Challenge / Tiro FBI) y seguís tu evolución
match a match.

## Quickstart

```bash
npm install
cp .env.example .env.local           # completar con credenciales de Supabase
# aplicar supabase/migrations/0001_initial_schema.sql en el SQL Editor
npm run dev                          # http://localhost:3000
```

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Supabase (Postgres + Auth) ·
Tailwind 4 · Vitest.

## Comandos

| Comando | Descripción |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Build de producción |
| `npm test` | Tests del parser e importer |
| `npm run test:watch` | Tests en watch mode |

## Documentación

Toda la documentación funcional vive en [`docs/`](./docs/README.md):

- [Setup local](./docs/development.md)
- [Arquitectura](./docs/architecture.md)
- [Modelo de datos](./docs/data-model.md)
- [Parsers](./docs/parsers.md)
- [Importación](./docs/importing.md)
- [Deployment](./docs/deployment.md)

## Estructura del proyecto

```
src/
├── app/             # rutas (route groups: (auth) y (app))
├── components/      # UI reutilizable
├── lib/
│   ├── db/          # capa de acceso a datos
│   ├── import/      # lógica de importación
│   ├── parsers/     # parsers de archivos externos
│   ├── supabase/    # clientes
│   └── types/       # tipos de dominio
└── proxy.ts         # refresh de sesión por request

supabase/migrations/ # SQL del schema
docs/                # documentación
tests/               # vitest + fixtures reales de PractiScore
```
