# Modelo de datos

## Diagrama lógico

```
auth.users ─┬─ profiles (1:1, perfil del usuario)
            ├─ shooters.linked_user_id (claim opcional, N:1)
            └─ firearms.owner_user_id (catálogo personal)

disciplines ─── divisions
matches ─── stages
matches ─── match_entries ─── stage_results
shooters ── match_entries
match_entries ── match_firearm_log ── firearms
```

## Tablas

### `profiles`

Perfil extendido del usuario logueado. Se crea automáticamente con un trigger
`on_auth_user_created` que lee `display_name` del `raw_user_meta_data` que
seteamos en el signup.

| col | tipo | notas |
|---|---|---|
| `id` | uuid PK | FK a `auth.users.id` |
| `display_name` | text | Nombre visible en la UI |
| `full_name` | text | Opcional |
| `member_number` | text | Opcional |

### `disciplines` y `divisions`

Lookups. Pre-cargados en migraciones.

- Disciplinas: `ipsc`, `steel_challenge`, `combat_solutions`, `tiro_fbi`. Las
  constantes canónicas viven en [`src/lib/disciplines.ts`](../src/lib/disciplines.ts).
- Divisiones IPSC: `O`, `P`, `PO`, `PCC`, `PCCO`, `S`, `SM`, `CO`, `R`, `CL`, `MS`.
- Divisiones Steel Challenge: `PISTOLA`, `REVOLVER`, `OPEN`, `ROOKIE`, `IRON`,
  `OPTIC`, `PCC`.
- Divisiones FBI: `PIS` (Pistola), `REV` (Revólver), `MINI` (Minirifle),
  `PCC`.

### `shooters`

Tiradores que aparecen en resultados. Pueden tener `linked_user_id` apuntando
a un `auth.users.id` (claim).

**Multi-identidad**: un mismo usuario puede claimar varios shooters (uno por
disciplina/torneo) porque el nombre escrito en cada planilla varía. Por eso
`linked_user_id` es N:1, no 1:1.

Resolución al importar: buscamos shooter por `(full_name ILIKE, member_number)`.
Si existe, se reusa; si no, se crea. Para evitar la race condition de
`Promise.all`, el importer cachea las resoluciones por nombre durante el
import (ver [`importing.md`](./importing.md)).

### `matches`

Torneos. **Públicos entre usuarios autenticados**. Solo el importador puede
borrar.

Unique constraint: `(discipline_id, name, date, region) NULLS NOT DISTINCT` —
evita duplicados aun cuando `region` es `NULL` (caso típico de FBI). Sin
`NULLS NOT DISTINCT`, dos imports con region=NULL se considerarían distintos
y se duplicaría el torneo.

### `stages`, `match_entries`, `stage_results`

- `match_entries` = resultado overall de un tirador en un match.
  - Unique: `(match_id, shooter_id, division_id)`.
- `stage_results` = resultado de un tirador en un stage.
  - Unique: `(stage_id, match_entry_id)`.
- Cascade delete desde `matches`.

### `match_reports`

Reportes de inconsistencias que un usuario levanta sobre un match. Visibles
para el reporter y el importador del match.

### `firearms`

Catálogo personal de armas del usuario. **Privado**.

| col | tipo | notas |
|---|---|---|
| `id` | uuid PK |  |
| `owner_user_id` | uuid | FK a `auth.users.id`, ON DELETE CASCADE |
| `name` | text | Required |
| `brand`, `model`, `caliber`, `notes` | text | Opcionales |

### `match_firearm_log`

Vincula un `match_entry` con un `firearm` y registra los tiros disparados.

| col | tipo | notas |
|---|---|---|
| `match_entry_id` | uuid PK | FK a `match_entries`, ON DELETE CASCADE |
| `firearm_id` | uuid | FK a `firearms`, ON DELETE CASCADE |
| `rounds_fired` | integer | CHECK ≥ 0 |
| `notes` | text | Opcional |

PK = `match_entry_id` (un arma por match en el MVP). Si en el futuro
necesitamos backup-gun/swap, evoluciona a PK compuesta.

## Row Level Security (RLS)

| Tabla | Lectura | Escritura |
|---|---|---|
| `profiles` | Cualquier autenticado (necesario para mostrar "Importado por X") | Solo el dueño |
| `disciplines`, `divisions` | Cualquier autenticado | (no se expone vía API) |
| `shooters` | Cualquier autenticado | Insert: cualquiera; Update: solo claim a sí mismo |
| `matches` | Cualquier autenticado | Insert: cualquiera; Delete: solo importador |
| `stages`, `match_entries`, `stage_results` | Cualquier autenticado | Solo importador del match |
| `match_reports` | Reporter o importador del match | Insert: cualquiera; Update: solo importador |
| `firearms` | Solo el dueño | Solo el dueño |
| `match_firearm_log` | Solo si el firearm es tuyo **y** el match_entry pertenece a un shooter linkeado a vos | Idem |

### Privacidad de estadísticas

La privacidad de matches/entries **no la dan las tablas** (los datos son
compartidos), sino la UI: en el dashboard solo mostramos *tus* resultados
aunque la tabla contenga los de todos.

En cambio, **firearms y match_firearm_log sí están aislados por RLS** — son
datos personales que nadie más puede leer.

## Migraciones

Todas en [`supabase/migrations/`](../supabase/migrations/), aplicar en orden:

| # | Archivo | Qué hace |
|---|---|---|
| 0001 | `0001_initial_schema.sql` | Schema inicial: profiles, disciplines, divisions IPSC, shooters, matches, stages, match_entries, stage_results, match_reports + RLS |
| 0002 | `0002_steel_challenge.sql` | Agrega `total_time_seconds` a `match_entries` + divisiones Steel Challenge |
| 0003 | `0003_steel_source_type.sql` | Suma `practiscore_steel_html` al CHECK de `matches.source_type` |
| 0004 | `0004_fbi.sql` | Divisiones FBI + suma `fbi_csv` al CHECK de `source_type` |
| 0005 | `0005_matches_nulls_not_distinct.sql` | Recrea el UNIQUE de matches con `NULLS NOT DISTINCT` (fix de duplicados FBI con region NULL) |
| 0006 | `0006_profiles_readable_by_authenticated.sql` | Abre el SELECT de `profiles` a todos los autenticados (para el "Importado por X") |
| 0007 | `0007_firearms.sql` | Tablas `firearms` + `match_firearm_log` con RLS por ownership |
