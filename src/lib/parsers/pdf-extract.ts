/**
 * Extracción de texto de PDFs, compartida por los parsers de PDF
 * (WinMSS de ipsc.org.ar y rankings oficiales de la FAT).
 *
 * Usamos `unpdf` (no `pdf-parse`) porque está hecho específicamente para
 * runtimes serverless (Vercel/Cloudflare) — `pdf-parse` v2 internamente
 * carga `pdfjs-dist` con build de browser, que requiere globals como
 * `DOMMatrix` que no existen en Node y rompe el import en producción.
 *
 * Reconstruimos el texto de cada página agrupando los items de pdfjs por
 * coordenada Y (filas) y ordenando por X (columnas). `unpdf.extractText`
 * solo concatena strings en el orden que están guardados en el PDF, que
 * puede ser column-major y romper completamente las regex de fila.
 *
 * `unpdf` se carga dinámicamente (~600KB) para no inflar el bundle de
 * import/page hasta que el usuario efectivamente sube un PDF.
 */

/** Una página de un PDF, ya extraída a texto plano. */
export interface PdfPage {
  num: number;
  text: string;
}

/**
 * Carga un PDF y devuelve, por página, el texto reconstruido por posición.
 */
export async function extractPdfPages(data: Uint8Array): Promise<PdfPage[]> {
  const tLoadStart = Date.now();
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(data);
  const tLoad = Date.now() - tLoadStart;

  let tGetTextContent = 0;
  let tReconstruct = 0;
  const pages: PdfPage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tGtc = Date.now();
    const content = await page.getTextContent();
    tGetTextContent += Date.now() - tGtc;
    const tRec = Date.now();
    const text = reconstructTextByPosition(content.items as unknown[]);
    tReconstruct += Date.now() - tRec;
    pages.push({ num: i, text });
  }

  console.log(
    `[pdf-extract] pages=${doc.numPages} bytes=${data.byteLength} ` +
      `load=${tLoad}ms getTextContent=${tGetTextContent}ms ` +
      `reconstruct=${tReconstruct}ms`,
  );

  return pages;
}

/**
 * Reconstruye texto plano a partir de los items con posición de pdfjs.
 *
 * Cada item de `getTextContent()` trae `str` (string) y `transform`
 * (matriz [a, b, c, d, e=x, f=y]). Agrupamos por Y (con tolerancia chica
 * porque el baseline del texto varía dentro de una fila), ordenamos por X
 * dentro de cada fila, y devolvemos las filas en orden top→bottom (Y desc
 * porque en PDF Y crece hacia arriba).
 */
export function reconstructTextByPosition(items: unknown[]): string {
  interface Item {
    str: string;
    x: number;
    y: number;
  }
  const parsed: Item[] = [];
  for (const raw of items) {
    if (
      typeof raw !== "object" ||
      raw === null ||
      !("str" in raw) ||
      !("transform" in raw)
    ) {
      continue;
    }
    const r = raw as { str: unknown; transform: unknown };
    if (typeof r.str !== "string" || !Array.isArray(r.transform)) continue;
    if (r.str.trim().length === 0) continue;
    parsed.push({
      str: r.str,
      x: typeof r.transform[4] === "number" ? r.transform[4] : 0,
      y: typeof r.transform[5] === "number" ? r.transform[5] : 0,
    });
  }
  if (parsed.length === 0) return "";

  // Top→bottom, left→right.
  parsed.sort((a, b) => b.y - a.y || a.x - b.x);

  // Agrupamos por Y con tolerancia: items con Y dentro de Y_TOL del primero
  // del grupo van a la misma fila.
  const Y_TOL = 2;
  const rows: Item[][] = [];
  for (const item of parsed) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0]!.y - item.y) <= Y_TOL) {
      last.push(item);
    } else {
      rows.push([item]);
    }
  }
  // Ordenamos por X dentro de cada fila y deduplicamos artefactos de
  // bold-rendering: algunos PDFs simulan texto en negrita dibujando el
  // mismo glyph 2-4 veces con un offset horizontal chico (<1pt). Sin esta
  // dedup el header "% Points Competitor..." sale como "% % % % Points
  // Points Points Points..." y termina contaminando la extracción del
  // título.
  //
  // Estrategia: si dos items consecutivos tienen la MISMA string y la X
  // difiere en menos de X_DEDUP_TOL, asumimos artefacto. Las columnas
  // reales en una tabla están separadas por mucho más (5pt+) así que
  // este threshold no debería pisar contenido legítimo.
  const X_DEDUP_TOL = 2;
  const dedupedRows = rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    const out: Item[] = [];
    for (const item of row) {
      const last = out[out.length - 1];
      if (
        last &&
        last.str === item.str &&
        Math.abs(item.x - last.x) <= X_DEDUP_TOL
      ) {
        continue;
      }
      out.push(item);
    }
    return out;
  });
  return dedupedRows
    .map((row) => row.map((i) => i.str).join(" "))
    .join("\n");
}
