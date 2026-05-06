# Parsers

## Dispatcher

[`src/lib/parsers/index.ts`](../src/lib/parsers/index.ts)

Punto de entrada único: `parseFile(content: string): ParsedMatch`. Detecta el
formato (HTML vs CSV) y delega al parser correspondiente. Hoy soporta tres:

| Disciplina | Formato fuente | Parser |
|---|---|---|
| Tiro Práctico (IPSC) | PractiScore HTML | `practiscore.ts` |
| Steel Challenge | PractiScore HTML (variante) | `steel-challenge.ts` |
| Tiro FBI | CSV exportado de Google Sheets | `fbi-csv.ts` |

Todos los parsers son **funciones puras** sin dependencias de DB ni de
browser, y devuelven el mismo tipo `ParsedMatch`
([`src/lib/types/match.ts`](../src/lib/types/match.ts)) para que el importer
sea agnóstico al formato de origen.

```ts
interface ParsedMatch {
  discipline: DisciplineCode;        // "ipsc" | "steel_challenge" | "tiro_fbi" | ...
  source: ParsedMatchSource;         // "practiscore_match_html" | "fbi_csv" | ...
  name: string;                      // ej "1er Ranking Social 2026"
  date: string;                      // ISO YYYY-MM-DD
  region: string | null;
  matchEntries: ParsedMatchEntry[];  // vacío si es archivo de stage
  stages: ParsedStage[];             // vacío si es archivo solo overall
  generatedBy: string | null;
}
```

## PractiScore HTML — IPSC

[`src/lib/parsers/practiscore.ts`](../src/lib/parsers/practiscore.ts)

PractiScore exporta tres formatos para Tiro Práctico:

| Formato | Cómo se reconoce |
|---|---|
| **Match Combined** | Un único bloque `<b>Match Results - Combined</b>` |
| **Match por división** | Varios bloques `<b>Match Results - X</b>` (uno por división) |
| **Stage** | Varios bloques `<b>Stage Results - X</b>` (uno por división) dentro del mismo stage |

### Cómo funciona

1. Parsea el HTML con `node-html-parser`.
2. Extrae `name` y `date` del `<h3>` principal.
3. Recorre todos los `<tr>` y los agrupa en secciones según los headers
   `<td class="division_head">`.
4. Para cada sección detecta si es `Match Results - X` o `Stage Results - X`.
5. Para cada fila, mapea las columnas según los `<th>` de esa sección.
6. Maneja casos especiales:
   - **DQ**: filas que arrancan con `(DQ)` — se marcan con `isDq=true`.
   - **Filas vacías**: se ignoran si no tienen `Place` o `Name`.
   - **Power factor**: solo acepta `Min` o `Maj`, otros valores → `null`.
   - **Member number `No.`**: vacío en el HTML → `null` en el output.

## PractiScore HTML — Steel Challenge

[`src/lib/parsers/steel-challenge.ts`](../src/lib/parsers/steel-challenge.ts)

Variante de PractiScore para Steel: una sola tabla con stages como columnas
("Stage 1", "Stage 2", ...) en vez de tablas separadas. Detección por
`Match Results - By Division` o "Steel Challenge" en el HTML.

Lo importante:

- Devuelve **match overall + stages embebidos** en un solo archivo (a
  diferencia de IPSC que necesita un archivo por stage).
- `total_time_seconds` se llena en cada `match_entry` (Steel puntúa por
  tiempo, no hit factor).
- `match_percentage` y `place` por stage se calculan a partir de los tiempos
  (`winner_time / own_time × 100`).

## CSV — Tiro FBI

[`src/lib/parsers/fbi-csv.ts`](../src/lib/parsers/fbi-csv.ts)

CSV exportado desde Google Sheets (Archivo → Descargar → CSV). Formato típico
de las planillas TFALP:

- Fila con título `Social N - DD/MM/YY` (de donde sale `name` y `date`).
- Fila de headers que incluye: `Tirador`, `Club`, `Categoría`, `Disciplina`,
  `Impactos`, `Puntos`.
- Filas de datos: una por (tirador, disciplina). Detalle de tiradas y warmup
  se ignora.

### Reglas

- La columna `Disciplina` del CSV se mapea al `code` de la división FBI:
  Pistola → `PIS`, Revólver → `REV`, Minirifle → `MINI`, PCC → `PCC`.
- Si un mismo tirador aparece varias veces en la **misma división** (raro,
  pero posible si la planilla registra tiradas de control), nos quedamos con
  el mejor puntaje. El UNIQUE de `match_entries` lo rechazaría, así que
  dedupeamos a nivel parser para no romper el import.
- `match_percentage` se calcula relativo al ganador de cada división
  (`puntos / winner_puntos × 100`), igual que IPSC.
- `region` queda `null` (la planilla no tiene una región global del torneo;
  el club aparece por tirador). El UNIQUE de `matches` está configurado con
  `NULLS NOT DISTINCT` para no permitir duplicados con region NULL.

### CSV row parser

Para evitar agregar una dependencia, el archivo incluye un mini-parser de
filas CSV que soporta:

- Comillas dobles para envolver campos con comas embebidas (típico en nombres
  como `"Mariperisena, Matías"`).
- Comillas dobles escapadas (`""` → `"`).

## Tests

| Test | Cubre |
|---|---|
| `tests/practiscore.test.ts` | 9 fixtures reales: 3 formatos, DQ, miembros sin número, etc. |
| `tests/steel-challenge.test.ts` | Detección de formato Steel + parseo de stages embebidos. |
| `tests/fbi-csv.test.ts` | Fixture real de TFALP: nombres con coma embebida, ranking por división, % relativo, places contiguos. |
| `tests/stage-resolution.test.ts` | `stripStageSuffix` + `findBestPrefixMatch` (resolución del match al subir un archivo de stage). |

Fixtures en `tests/fixtures/practiscore/` y `tests/fixtures/fbi/`.

## Agregar un parser nuevo

1. `src/lib/parsers/{nombre}.ts` exporta `parse{Nombre}` y opcionalmente
   `is{Nombre}Format` para detección.
2. Importa la disciplina desde [`src/lib/disciplines.ts`](../src/lib/disciplines.ts);
   si la disciplina es nueva, agregala primero ahí + en la migración.
3. Si la disciplina es nueva, agregá su `source_type` a la migración del
   CHECK de `matches.source_type` y al union `ParsedMatchSource`.
4. Sumá la detección al dispatcher [`parsers/index.ts`](../src/lib/parsers/index.ts).
5. Tests con fixtures reales en `tests/fixtures/{nombre}/`.
