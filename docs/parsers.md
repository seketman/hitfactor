# Parsers

## PractiScore HTML

[`src/lib/parsers/practiscore.ts`](../src/lib/parsers/practiscore.ts)

PractiScore exporta tres formatos de HTML para Tiro Práctico:

| Formato | Cómo se reconoce |
|---|---|
| **Match Combined** | Un único bloque `<b>Match Results - Combined</b>` |
| **Match por división** | Varios bloques `<b>Match Results - X</b>` (uno por división) |
| **Stage** | Varios bloques `<b>Stage Results - X</b>` (uno por división) dentro del mismo stage |

El parser detecta el formato a partir de las secciones encontradas y devuelve
un objeto `ParsedMatch` con la estructura:

```ts
interface ParsedMatch {
  discipline: "ipsc";
  source: "practiscore_match_html" | "practiscore_combined_html" | "practiscore_stage_html";
  name: string;        // ej "1er Ranking Social 2026"
  date: string;        // ISO YYYY-MM-DD
  region: string | null;
  matchEntries: ParsedMatchEntry[];   // vacío si es archivo de stage
  stages: ParsedStage[];              // vacío si es archivo de match overall
  generatedBy: string | null;
}
```

## Cómo funciona

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

## Tests

[`tests/practiscore.test.ts`](../tests/practiscore.test.ts) corre el parser
contra 9 fixtures reales en `tests/fixtures/practiscore/`. Cubre los 3
formatos y casos como DQ, miembros sin número, etc.

## Otros parsers (futuro)

- **PractiScore PDF**: planeado — usaría `pdf-parse` o `pdfjs`.
- **Steel Challenge**: estructura distinta (5 strings por stage, `Time +`).
- **Tiro FBI**: estructura distinta.

Cada parser nuevo debería:

1. Vivir en `src/lib/parsers/{nombre}.ts`.
2. Tomar `string` (HTML o text content del PDF) y devolver un `ParsedMatch`.
3. Tener tests con fixtures reales en `tests/fixtures/{nombre}/`.
