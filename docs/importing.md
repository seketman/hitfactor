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

## Cómo llega el archivo al server

El archivo **no viaja en el body del server action**. El browser lo sube
directo a Supabase Storage y el server action recibe solo una referencia
`{ path, filename }`; después lo baja server-side, lo parsea y borra el
objeto de staging.

```
browser ──upload──> Storage (bucket `match-imports`)
   │                        │
   └──{path,filename}──> server action ──download──> parser ──> DB
                                 └──remove──> Storage
```

Por qué, y no el camino obvio de mandarlo en el FormData: **Vercel corta
el request body de una Function en 4.5 MB** a nivel plataforma y devuelve
`413 FUNCTION_PAYLOAD_TOO_LARGE` antes de invocar el código. Los PDFs de
stages WinMSS pasan ese límite (vimos uno de 8 MB con 144 páginas).
`experimental.serverActions.bodySizeLimit` **no** puede levantar ese
techo — es un límite de Next, no de Vercel, y solo aplica en dev local.

Piezas:

| Archivo | Rol |
|---|---|
| `supabase/migrations/0020_import_uploads_storage.sql` | Bucket + policies de RLS |
| `src/lib/import/upload-to-storage.ts` | Upload desde el browser |
| `src/lib/import/storage.ts` | Validación del path, download y limpieza server-side |
| `ImportForm.tsx` (`uploadThenImport`) | Wrapper cliente: sube y después llama al server action |

Los objetos van a `<user_id>/<uuid>.<ext>` y las policies exigen que el
primer segmento sea el uid del JWT — es lo que impide leer o escribir la
carpeta de otro usuario. `parseUploadedRef` valida la forma del path
antes de tocar Storage (tests en `tests/import-storage.test.ts`).

**Límites, y por qué son explícitos.** El server action acepta hasta
`MAX_IMPORT_FILES` referencias, descarta las repetidas, y corta la
descarga si los bytes acumulados pasan `MAX_IMPORT_TOTAL_BYTES`. No es
paranoia: antes del bucket, el techo de 4.5 MB de Vercel acotaba esto sin
que nadie lo decidiera. Ahora las referencias son JSON de ~100 bytes y
entran miles en un request, así que la cota tiene que estar escrita.

**Limpieza en dos niveles.** `cleanupImportFiles` corre en todos los
caminos de salida del server action, pero es best-effort y hay huérfanos
que no puede cubrir: el usuario que cierra la pestaña a mitad del upload, o
un batch multi-archivo donde uno falla y los demás ya subieron. Para esos,
`purgeStaleUploads` barre al principio de cada import lo que tenga más de
un día en la carpeta de ese usuario.

Ojo con la tentación de resolverlo con un cron de Postgres: **borrar de
`storage.objects` con SQL no borra el archivo**. Saca la fila de metadata y
deja el blob huérfano en S3 contando contra la cuota, sin forma de
encontrarlo después. Hay que usar la API de Storage
([doc](https://supabase.com/docs/guides/storage/management/delete-objects)).

Queda un caso sin cubrir: alguien que sube un archivo, abandona, y **nunca
vuelve a importar**. Para eso hace falta un barrido central con service
role (una Edge Function agendada), que es una decisión de infra aparte.

El `filename` original viaja aparte del path a propósito: los parsers de
FAT y Steel Challenge lo usan como dato de entrada (fecha del torneo,
orden de stages), y el path es un uuid.

## Imports parciales: el parser frena, no importa a medias

Si el parser de WinMSS lee **algunas** filas de una página pero se le
escapan otras, tira y no se importa nada.

No es paranoia: el match *CENTRO REPUBLICA CHALLENGE 2026 BY GR PCC
Edition* entró con **un solo tirador de once**. Los puntajes traían
separador de miles, el regex de fila no lo contemplaba, y las filas DQ
—que van por otro regex, sin columna de puntos— pasaban igual. Ninguna de
las guardas de entonces saltó, porque todas preguntaban "¿parseamos algo?"
y la respuesta era sí. El import terminó con pantalla de éxito.

La detección compara, por página, las líneas **con forma de fila** contra
las que efectivamente se parsearon. Una línea cuenta como fila si arranca
con `<número> <número>` **y** tiene una coma. Las dos condiciones importan:

- Sin la primera, entrarían headers y footers.
- Sin la segunda, un título como `2026 3RA FECHA COPA SOCIAL` contaría como
  fila perdida y rompería el import de ese torneo.

Las filas DQ del formato ESS (`89 APELLIDO, Max DQ`) no matchean la primera
condición —después del dorsal viene una letra—, así que una división cuyo
único tirador se fue DQ pasa sin ruido. Ese caso es raro pero legítimo.

**Consecuencia a tener en cuenta:** un PDF con una fila ilegible que antes
importaba parcialmente ahora falla entero. Es deliberado — datos
incompletos en una base compartida son peores que un error visible— pero
si aparece un formato nuevo, el síntoma va a ser "no importa nada" en vez
de "importa poco". El mensaje de error dice qué página y cuántas filas.

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

### Errores de subida (antes de llegar al server)

Estos no son `ImportError`: pasan en el browser, mientras sube al bucket,
así que el server action ni se entera. Se muestran dentro del form y las
traducciones viven en `messages/*.json` bajo `import.form.uploadError`.

| Code | Cuándo se tira |
|---|---|
| `not_authenticated` | No hay sesión válida al momento de subir (o falló el `getUser`) |
| `too_large` | Un archivo supera `MAX_IMPORT_FILE_BYTES` |
| `too_many` | Más de `MAX_IMPORT_FILES` archivos en un mismo import |
| `bucket_missing` | El bucket no existe — típicamente se deployó sin correr la migración 0020 |
| `upload_failed` | Cualquier otra falla del upload (red, permisos) |

## Tests

| Test | Cubre |
|---|---|
| `tests/import-match.test.ts` | Reglas anteriores con un mock minimal de Supabase. Incluye el regression test del race condition con tirador repetido. |
| `tests/match-claim.test.ts` | Algoritmo de matching de nombres + escenarios multi-identidad. |
| `tests/stage-resolution.test.ts` | Fuzzy match de nombre de match al subir un stage. |
| `tests/import-storage.test.ts` | Validación del path que manda el cliente (`parseUploadedRef`), presupuesto de bytes de la descarga, y el contrato de "la limpieza nunca tira". |
