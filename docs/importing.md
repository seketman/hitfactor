# Flujo de importación

## Reglas de negocio

1. **Cualquier usuario autenticado puede importar.** Los matches son datos
   compartidos: todos los autenticados los ven.

2. **Solo el importador puede borrar el match.** No hay edit — si está mal,
   se elimina y se reimporta.

3. **Deduplicación automática.** El UNIQUE de `matches` es
   `(discipline_id, name, date, region) NULLS NOT DISTINCT`, así que dos
   imports con region NULL **sí** se consideran iguales (necesario para FBI,
   que no tiene region por torneo). Si alguien intenta reimportar, se
   devuelve `MATCH_ALREADY_EXISTS`.

4. **Match overall primero, stages después** *(IPSC)*. Los archivos de
   `Stage Results` requieren que el match overall ya exista (matcheo por
   `name + date`, con fuzzy fallback si el sufijo del stage es desconocido).
   Si no, `MATCH_NOT_FOUND`.

5. **Steel Challenge y FBI traen stages embebidos en un solo archivo.** El
   importer detecta y los inserta en la misma operación que el match overall.

6. **Solo el importador del match puede agregarle stages.** `NOT_MATCH_OWNER`
   si no.

7. **Re-importar un stage es idempotente.** Los `stage_results` se hacen con
   `upsert` sobre `(stage_id, match_entry_id)`, así no se duplican.

8. **Resolución de shooters** *(crítico — race condition fix)*. Por cada
   tirador del archivo:
   - Buscar por `(full_name ILIKE, member_number)`.
   - Si existe, reusar.
   - Si no, crear nuevo `shooter` (sin claim).
   
   La resolución es **secuencial y cacheada** dentro del import: una sola
   llamada a `findOrCreateShooter` por tirador único. Antes esto se hacía
   con `Promise.all` y producía duplicados cuando el mismo tirador aparecía
   en varias divisiones del CSV (típico FBI).

## Formatos soportados

| Disciplina | Formato | Single file? | Stages embebidos? |
|---|---|---|---|
| IPSC | PractiScore HTML | No | No (archivo aparte por stage) |
| Steel Challenge | PractiScore HTML | Sí | Sí |
| Tiro FBI | CSV de Google Sheets | Sí | No (FBI no expone stages) |

Detección automática en [`src/lib/parsers/index.ts`](../src/lib/parsers/index.ts):
HTML vs CSV → Steel vs IPSC dentro de HTML.

## Multi-identidad

Un usuario puede tener varios `shooters` linkeados (uno por cada variante de
su nombre que usaron las distintas planillas). El sistema lo soporta de punta
a punta:

- `findClaimCandidates` usa los nombres de los shooters ya linkeados como
  **aliases adicionales** para sugerir nuevos claims. Si ya claimaste
  "Demarziani, Diego D." en IPSC, ese nombre alimenta el matching de "Demarziani Diego" en FBI.
- `claimShooter` no exige que el usuario tenga 0 shooters previos.
- El dashboard agrega entries de **todas** las identidades.
- `/matches/[id]/me` busca cuál de tus identidades participó en ese match.

Tests: `tests/match-claim.test.ts`.

## Auto-detección de claim

Después de importar, [`src/app/(app)/import/page.tsx`](../src/app/(app)/import/page.tsx)
muestra un panel "¿Sos alguno de estos tiradores?" con los shooters del match
que parecen ser el usuario logueado.

Algoritmo de matching ([`src/lib/import/match-claim.ts`](../src/lib/import/match-claim.ts)):

- **Por número de socio**: coincidencia exacta del `member_number` contra
  cualquiera de los aliases (profile + shooters ya linkeados).
- **Por nombre**: tokens normalizados (lowercase, sin acentos, sin
  puntuación), requiriendo que el set más chico esté contenido en el más
  grande y tenga al menos 2 tokens distintos. Esto evita falsos positivos
  por apellidos comunes.

## Flujo del usuario

1. **Subir el archivo** (Match Results de PractiScore, planilla Steel, o CSV
   FBI).
2. **Si hay sugerencias de claim**, dale "Soy yo" para linkear.
3. **Si no aparecieron sugerencias**, andá al match (`/matches/[id]`) y dale
   "Soy yo" en tu fila manualmente.
4. **(Opcional) Asignar arma usada** en `/matches/[id]/me` con el
   `FirearmSelector`.
5. **Subir Stage Results** *(IPSC solo)* uno por archivo, uno por stage.
6. **Dashboard** → KPIs y evolución actualizados.

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

| Test | Cubre |
|---|---|
| `tests/import-match.test.ts` | Reglas anteriores con un mock minimal de Supabase. Incluye el regression test del race condition con tirador repetido. |
| `tests/match-claim.test.ts` | Algoritmo de matching de nombres + escenarios multi-identidad. |
| `tests/stage-resolution.test.ts` | Fuzzy match de nombre de match al subir un stage. |
