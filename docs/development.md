# Desarrollo local

## Requisitos

- Node 20+ (probado con 25)
- npm 11+
- Una cuenta de Supabase (free tier alcanza)

## Setup inicial

```bash
git clone <repo>
cd HitFactor
npm install
cp .env.example .env.local
# editar .env.local con tus credenciales de Supabase
```

Variables esperadas en `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
```

## Levantar la DB

Aplicar **todas** las migraciones en Supabase, en orden numérico:

1. Abrir el SQL Editor del proyecto.
2. Pegar y ejecutar los archivos en orden:

| # | Archivo | Qué hace |
|---|---|---|
| 0001 | [`0001_initial_schema.sql`](../supabase/migrations/0001_initial_schema.sql) | Schema completo: profiles, disciplines, divisions (IPSC + Steel + FBI), shooters, matches, stages, match_entries, stage_results, match_reports, firearms, audit_log, feedback, clubs y RLS |
| 0002 | [`0002_my_discipline_counts.sql`](../supabase/migrations/0002_my_discipline_counts.sql) | RPC `my_discipline_counts(p_user_id)` — agrega en Postgres el conteo de participaciones por disciplina del usuario (lo consume el sidebar) |

Para desarrollo se recomienda **deshabilitar la confirmación por email** en
Supabase → *Authentication → Sign In / Providers → Email* — así podés crear
cuentas de prueba sin tener que confirmar.

## Comandos

```bash
npm run dev          # dev server (localhost:3000)
npm run build        # build de producción
npm test             # corre tests una vez
npm run test:watch   # tests en watch mode
npm run db:types     # regenera src/lib/supabase/database.types.ts desde la DB
```

`db:types` necesita un `SUPABASE_ACCESS_TOKEN` en el entorno (o `supabase
login` previo). Correlo después de aplicar una migración que cambie el
schema, así el cliente Supabase tipado queda sincronizado.

## Estructura del proyecto

Ver [`architecture.md`](./architecture.md).

## Verificación rápida después de cambios

```bash
npm test && npx tsc --noEmit && npm run build
```

Los tres tienen que pasar. Hoy: 243 tests verdes, typecheck limpio.
