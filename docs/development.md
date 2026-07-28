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
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### `NEXT_PUBLIC_SITE_URL`

URL absoluta del sitio. Es la fuente de verdad para toda la metadata SEO:
canonical, sitemap, robots, Open Graph y JSON-LD. Si no está definida, el
default en local es `http://localhost:3000`.

En Vercel se setea por environment (Production / Preview / Development) con el
dominio real de cada uno — así el canonical y los previews apuntan al host
correcto en cada deploy.

## Levantar la DB

Aplicar **todas** las migraciones en Supabase, en orden numérico:

1. Abrir el SQL Editor del proyecto.
2. Pegar y ejecutar los archivos en orden:

> La 0001 es un **squash de la historia previa a mayo 2026**, no un
> bootstrap completo. Después de consolidarla la numeración arrancó de
> nuevo, así que las 0002+ son posteriores y hacen falta igual: sin ellas
> te quedás sin `is_absent`, `min_shots`, `qr_code`, `is_admin`, las tablas
> de municiones y uso de armas, y el bucket de Storage de los imports.
> Corré **todas**, en orden.

| # | Archivo | Qué hace |
|---|---|---|
| 0001 | [`0001_initial_schema.sql`](../supabase/migrations/0001_initial_schema.sql) | Esquema base consolidado: profiles, disciplines, divisions, shooters, matches, stages, match_entries, stage_results, firearms, match_firearm_log, clubs, audit_log, feedback + índices, triggers, RLS y seeds |
| 0002 | [`0002_my_discipline_counts.sql`](../supabase/migrations/0002_my_discipline_counts.sql) | RPC `my_discipline_counts(p_user_id)` — agrega en Postgres el conteo de participaciones por disciplina del usuario (lo consume el sidebar) |
| 0003 | [`0003_security_advisor_fixes.sql`](../supabase/migrations/0003_security_advisor_fixes.sql) | Fixes del Security Advisor de Supabase: `search_path` fijo en las funciones y demás warnings del linter |
| 0004 | [`0004_fat_pdf_source.sql`](../supabase/migrations/0004_fat_pdf_source.sql) | Amplía el CHECK de `matches.source_type` con `fat_pdf` (rankings oficiales en PDF de la FAT) |
| 0005 | [`0005_profiles_admin.sql`](../supabase/migrations/0005_profiles_admin.sql) | `profiles.is_admin` — habilita las vistas de diagnóstico restringidas a administradores |
| 0006 | [`0006_match_dedup_utilities.sql`](../supabase/migrations/0006_match_dedup_utilities.sql) | Utilidades de auditoría y limpieza de entries duplicadas por re-import (`merge_duplicate_shooters` y afines) |
| 0007 | [`0007_match_entries_absent.sql`](../supabase/migrations/0007_match_entries_absent.sql) | `match_entries.is_absent` — distingue "no compitió" de "compitió y le fue mal" |
| 0008 | [`0008_match_entries_update_extended.sql`](../supabase/migrations/0008_match_entries_update_extended.sql) | Amplía la RLS de UPDATE sobre `match_entries`: además del importador, admins y el propio tirador |
| 0009 | [`0009_backfill_is_absent.sql`](../supabase/migrations/0009_backfill_is_absent.sql) | Backfill de `is_absent` en los matches importados antes de la 0007 (evita re-importar) |
| 0010 | [`0010_ammunition_types.sql`](../supabase/migrations/0010_ammunition_types.sql) | Catálogo de municiones por tirador, factory y reload (#46) |
| 0011 | [`0011_firearm_usage_log.sql`](../supabase/migrations/0011_firearm_usage_log.sql) | Log de uso de armas fuera de torneos — entrenamiento y práctica (#47) |
| 0012 | [`0012_firearm_qr_codes.sql`](../supabase/migrations/0012_firearm_qr_codes.sql) | Código corto por arma + ruta `/q/{code}`, para que el QR pegado al arma sea chico (#58) |
| 0013 | [`0013_firearm_qr_code_default.sql`](../supabase/migrations/0013_firearm_qr_code_default.sql) | Reemplaza el trigger que generaba `qr_code` por un DEFAULT de columna, para que `gen types` lo vea opcional |
| 0014 | [`0014_match_min_shots.sql`](../supabase/migrations/0014_match_min_shots.sql) | `matches.min_shots` — base del KPI de "disparos extra" contra `rounds_fired` (#75) |
| 0015 | [`0015_steel_pdf_source.sql`](../supabase/migrations/0015_steel_pdf_source.sql) | Amplía el CHECK de `source_type` con `practiscore_steel_pdf` (PDFs de Steel Challenge) |
| 0016 | [`0016_fbi_classic_division.sql`](../supabase/migrations/0016_fbi_classic_division.sql) | División `CLASSIC` para Tiro FBI |
| 0017 | [`0017_ipsc_classic_manual_division.sql`](../supabase/migrations/0017_ipsc_classic_manual_division.sql) | División `CM` (Classic Manual) para IPSC — escopeta exportada de PractiScore |
| 0018 | [`0018_update_ui_prefs_rpc.sql`](../supabase/migrations/0018_update_ui_prefs_rpc.sql) | RPC `update_ui_prefs` — merge atómico de `ui_prefs`, evita lost updates (#126) |
| 0019 | [`0019_fbi_optic_division.sql`](../supabase/migrations/0019_fbi_optic_division.sql) | División `OPTIC` para Tiro FBI |
| 0020 | [`0020_import_uploads_storage.sql`](../supabase/migrations/0020_import_uploads_storage.sql) | Bucket privado `match-imports` + policies RLS por usuario, para el staging de archivos de import |

Si agregás una migración, agregá su fila acá: hay un test
(`tests/migrations-doc.test.ts`) que falla si el directorio y esta tabla se
desincronizan. Esa tabla estuvo desactualizada 18 migraciones seguidas
justamente porque nada lo verificaba.

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
