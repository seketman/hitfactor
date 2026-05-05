# Modelo de datos

## Diagrama lógico

```
auth.users ─┬─ profiles (1:1, perfil del usuario)
            └─ shooters.linked_user_id (claim opcional)

disciplines ─── divisions
matches ─── stages
matches ─── match_entries ─── stage_results
shooters ── match_entries
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
Lookups. Pre-cargados en la migración inicial.

- Disciplinas: `ipsc`, `steel_challenge`, `combat_solutions`, `tiro_fbi`.
- Divisiones IPSC: `O`, `P`, `PO`, `PCC`, `PCCO`, `S`, `SM`, `CO`, `R`, `CL`, `MS`.

### `shooters`
Tiradores que aparecen en resultados. Pueden tener `linked_user_id` apuntando
a un `auth.users.id` (claim).

Buscamos un shooter por `(full_name, member_number)` para no duplicar.

### `matches`
Torneos. **Públicos entre usuarios autenticados**. Solo el importador puede
borrar.

Unique constraint: `(discipline_id, name, date, region)` — evita duplicados.

### `stages`, `match_entries`, `stage_results`
- `match_entries` = resultado overall de un tirador en un match.
  - Unique: `(match_id, shooter_id, division_id)`.
- `stage_results` = resultado de un tirador en un stage.
  - Unique: `(stage_id, match_entry_id)`.
- Cascade delete desde `matches`.

### `match_reports`
Reportes de inconsistencias que un usuario levanta sobre un match. Visibles
para el reporter y el importador del match.

## Row Level Security (RLS)

| Tabla | Lectura | Escritura |
|---|---|---|
| `profiles` | Solo el dueño | Solo el dueño |
| `disciplines`, `divisions` | Cualquier autenticado | (no se expone vía API) |
| `shooters` | Cualquier autenticado | Insert: cualquiera; Update: solo claim a sí mismo |
| `matches` | Cualquier autenticado | Insert: cualquiera; Delete: solo importador |
| `stages`, `match_entries`, `stage_results` | Cualquier autenticado | Solo importador del match |
| `match_reports` | Reporter o importador del match | Insert: cualquiera; Update: solo importador |

### Privacidad de estadísticas

La privacidad **no la dan las tablas** (los datos son públicos), sino la UI:
en el dashboard solo mostramos *tus* resultados aunque la tabla contenga los
de todos.

## Migraciones

- [`supabase/migrations/0001_initial_schema.sql`](../supabase/migrations/0001_initial_schema.sql)
