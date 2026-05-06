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
| 0001 | [`0001_initial_schema.sql`](../supabase/migrations/0001_initial_schema.sql) | Schema inicial (profiles, disciplines, divisions IPSC, shooters, matches, stages, match_entries, stage_results, match_reports, RLS) |
| 0002 | [`0002_steel_challenge.sql`](../supabase/migrations/0002_steel_challenge.sql) | Soporte Steel Challenge (`total_time_seconds` + divisiones) |
| 0003 | [`0003_steel_source_type.sql`](../supabase/migrations/0003_steel_source_type.sql) | `practiscore_steel_html` en CHECK de source_type |
| 0004 | [`0004_fbi.sql`](../supabase/migrations/0004_fbi.sql) | Divisiones Tiro FBI + `fbi_csv` en CHECK |
| 0005 | [`0005_matches_nulls_not_distinct.sql`](../supabase/migrations/0005_matches_nulls_not_distinct.sql) | UNIQUE de matches resistente a region NULL |
| 0006 | [`0006_profiles_readable_by_authenticated.sql`](../supabase/migrations/0006_profiles_readable_by_authenticated.sql) | SELECT de profiles abierto a autenticados |
| 0007 | [`0007_firearms.sql`](../supabase/migrations/0007_firearms.sql) | Catálogo de armas y log de uso por match |

Para desarrollo se recomienda **deshabilitar la confirmación por email** en
Supabase → *Authentication → Sign In / Providers → Email* — así podés crear
cuentas de prueba sin tener que confirmar.

## Comandos

```bash
npm run dev          # dev server (localhost:3000)
npm run build        # build de producción
npm test             # corre tests una vez
npm run test:watch   # tests en watch mode
```

## Estructura del proyecto

Ver [`architecture.md`](./architecture.md).

## Verificación rápida después de cambios

```bash
npm test && npx tsc --noEmit && npm run build
```

Los tres tienen que pasar. Hoy: 130 tests verdes, typecheck limpio.
