# Flujo de importación

## Reglas de negocio

1. **Cualquier usuario autenticado puede importar.** Los datos son
   compartidos: todos los usuarios autenticados ven los matches.

2. **Solo el importador puede borrar el match.** No hay edit — si está mal,
   se elimina y se reimporta.

3. **Deduplicación automática.** La unique constraint
   `(discipline_id, name, date, region)` impide subir el mismo torneo dos veces.
   Si alguien intenta, se devuelve `MATCH_ALREADY_EXISTS`.

4. **Match overall primero, stages después.** Los archivos de stages requieren
   que el match overall ya exista (matcheo por `name + date`). Si no,
   `MATCH_NOT_FOUND`.

5. **Solo el importador del match puede agregarle stages.** Esto evita que un
   user A importe un match y otro user B le sume datos. Si pasa,
   `NOT_MATCH_OWNER`.

6. **Re-importar un stage es idempotente.** Los `stage_results` se hacen con
   `upsert` sobre `(stage_id, match_entry_id)`, así no se duplican.

7. **Resolución de shooters.** Por cada tirador del archivo:
   - Buscar por `(full_name, member_number)` (case-insensitive).
   - Si existe, reusar.
   - Si no, crear nuevo `shooter` (sin claim).

## Flujo del usuario

1. **Subir Match Results** (combined o por división) → crea match + entries.
2. **Subir Stage Results** (uno por archivo, uno por stage) → cada uno suma
   un `stage` y sus `stage_results`.
3. **Buscar tu nombre** en cualquier match y darle "Soy yo" → linkea tu
   `auth.user` con tu `shooter`.
4. **Dashboard** → empezás a ver tus resultados destacados.

## Errores conocidos (códigos)

| Code | Cuándo se tira |
|---|---|
| `UNKNOWN_DISCIPLINE` | El parser devolvió una disciplina que no existe en `disciplines` |
| `DIVISIONS_FETCH_FAILED` | No se pudo cargar la lookup de divisiones |
| `UNKNOWN_DIVISION` | Aparece una división no registrada — pedir a admin que la agregue |
| `MATCH_INSERT_FAILED` | Error genérico al insertar el match |
| `MATCH_ALREADY_EXISTS` | Unique violation: ese match ya existe |
| `MATCH_NOT_FOUND` | Subiste un stage sin haber subido antes el match overall |
| `MATCH_LOOKUP_FAILED` | Error de query buscando el match |
| `NOT_MATCH_OWNER` | Querés agregar stages a un match que no importaste vos |
| `STAGE_INSERT_FAILED` | Error insertando el stage |
| `STAGE_RESULTS_INSERT_FAILED` | Error insertando los stage_results |
| `MATCH_ENTRIES_INSERT_FAILED` | Error insertando los match_entries |
| `SHOOTER_INSERT_FAILED` | Error insertando un shooter |

## Tests

[`tests/import-match.test.ts`](../tests/import-match.test.ts) cubre las
reglas anteriores con un mock minimal del cliente Supabase
(`tests/helpers/supabase-mock.ts`), sin tocar DB real.
