/**
 * Converts the ESS web results page, printed to PDF by a browser, into a PDF
 * laid out like the genuine ESS "Results by Stage" report, which
 * `winmss-pdf.ts` already reads.
 *
 * The web print is not a supported format (see "One-off formats" in
 * `docs/importing.md`): it has the `X - Results by Stage` headers but no
 * `Printed:` line, every page carries the browser's header and footer, and a
 * section flows across pages with no repeated header. Rather than teach the
 * parser a layout seen once, this rewrites the file into one it knows: one
 * (division x stage) section per page, each with its own headers.
 *
 * The title and the `Printed:` line are copied from the match's overall PDF.
 * The importer attaches a stages file to an existing match by name and date,
 * and both are read from those two lines, so taking them from the overall is
 * what makes the converted stages land on the match already imported.
 *
 * Nothing is written unless every line after the first division header is
 * accounted for and the generated PDF, read back through the parser, matches
 * the source.
 *
 * Usage:
 *   npm run pdf:ess-stages -- <web-print.pdf> <overall.pdf> <out.pdf>
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parsePdf } from "../src/lib/parsers/index.ts";
import {
  extractPdfPages,
  type PdfPage,
} from "../src/lib/parsers/pdf-extract.ts";

const USAGE = `Usage: npm run pdf:ess-stages -- <web-print.pdf> <overall.pdf> <out.pdf>

  web-print.pdf   the ESS results page (group=stage) printed to PDF
  overall.pdf     the ESS overall report of the same match (source of the
                  title and the "Printed:" line)
  out.pdf         where to write the converted stages report`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function readPages(path: string): Promise<PdfPage[]> {
  let data: Uint8Array;
  try {
    data = new Uint8Array(await readFile(path));
  } catch (error) {
    fail(`Cannot read ${path}: ${error instanceof Error ? error.message : error}`);
  }
  try {
    return await extractPdfPages(data);
  } catch (error) {
    fail(
      `Failed to extract text from ${path}: ` +
        `${error instanceof Error ? error.message : error}`,
    );
  }
}

/** Collapses the runs of spaces the positional reconstruction can leave. */
const normalize = (line: string) => line.trim().replace(/\s+/g, " ");

// Lines the browser adds to every printed page: "<date>, <time> <page title>"
// on top and "<url> <n>/<N>" at the bottom.
const BROWSER_HEADER_RE =
  /^\d{1,2}\/\d{1,2}\/\d{2,4},\s+\d{1,2}:\d{2}\s*(AM|PM)?\s+.*- ESS$/;
const BROWSER_FOOTER_RE = /^https?:\/\/\S+\s+\d+\/\d+$/;
// The export buttons the web page renders next to the first header. Each
// label is preceded by an icon-font glyph, which is why `\W` and not a space.
const EXPORT_BUTTONS_RE = /^\W*PDF\W+Excel$/;
const DIVISION_HEADER_RE = /^([A-Z][A-Z ]*?) - Results by Stage$/;
const STAGE_HEADER_RE = /^Stage ([A-Za-z][A-Za-z ]*?) - Stage (\d+)$/;
const COLUMNS_RE = /^% Points Competitor/;
// "<place> <%> <points> <bib> <Surname, Name> [meta]"
const ROW_RE = /^(\d+)\s+(\d+\.\d{2})\s+([\d,]+\.\d{4})\s+(\d+)\s+(.+)$/;
// Together with "the line has a comma" (the name is "Surname, Name"), the
// test the parser uses to tell a result row from any other line.
const ROW_SHAPED_RE = /^\d+\s+\d/;

const COLUMNS_LINE = "% Points Competitor Cat Reg Cls Tag ICS";

interface Section {
  division: string;
  stageLabel: string;
  stageNumber: number;
  rows: string[];
}

const args = process.argv.slice(2);
if (args.length !== 3 || args.some((arg) => arg.startsWith("-"))) {
  fail(USAGE);
}
const [webPrintPath, overallPath, outPath] = args;
if ([webPrintPath, overallPath].some((p) => resolve(p) === resolve(outPath))) {
  fail("The output path must differ from both inputs.");
}

// ---- title and "Printed:" line, from the overall ---------------------------

const overallPages = await readPages(overallPath);
const overallLines = (overallPages[0]?.text ?? "")
  .split("\n")
  .map(normalize)
  .filter(Boolean);
const title = overallLines[0];
const printedLine = overallLines.find((line) => /^Printed:/.test(line));
if (!title || !printedLine) {
  fail(
    `${overallPath} does not look like an ESS overall report: ` +
      `no title or "Printed:" line on its first page.`,
  );
}
// The web page repeats the match name without the " - <discipline>" suffix
// the report title carries.
const bareMatchName = title.replace(/\s+-\s+[^-]+$/, "");

// ---- sections, from the web print -----------------------------------------

const pages = await readPages(webPrintPath);

const sections: Section[] = [];
const unexpected: string[] = [];
let division: string | null = null;
let current: Section | null = null;
let rowShapedLines = 0;

for (const page of pages) {
  for (const raw of page.text.split("\n")) {
    const line = normalize(raw);
    if (!line) continue;
    if (ROW_SHAPED_RE.test(line) && line.includes(",")) rowShapedLines++;
    if (BROWSER_HEADER_RE.test(line) || BROWSER_FOOTER_RE.test(line)) continue;

    const divisionMatch = DIVISION_HEADER_RE.exec(line);
    if (divisionMatch) {
      division = divisionMatch[1]!;
      continue;
    }
    // Everything above the first division header is the page's own chrome
    // (match details, navigation menus).
    if (division == null) continue;

    const stageMatch = STAGE_HEADER_RE.exec(line);
    if (stageMatch) {
      current = {
        division,
        stageLabel: line,
        stageNumber: parseInt(stageMatch[2]!, 10),
        rows: [],
      };
      sections.push(current);
      continue;
    }
    if (
      COLUMNS_RE.test(line) ||
      EXPORT_BUTTONS_RE.test(line) ||
      line === title ||
      line === bareMatchName
    ) {
      continue;
    }
    if (ROW_RE.test(line) && current) {
      current.rows.push(line);
      continue;
    }
    unexpected.push(`page ${page.num}: ${line}`);
  }
}

// ---- checks: nothing is written unless all of them pass --------------------

if (sections.length === 0) {
  fail(
    `${webPrintPath} has no "Stage <Division> - Stage NN" section — ` +
      `not an ESS results page grouped by stage.`,
  );
}
if (unexpected.length > 0) {
  fail(
    `${unexpected.length} line(s) of ${webPrintPath} were not recognised; ` +
      `refusing to convert:\n  ${unexpected.join("\n  ")}`,
  );
}

const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0);
if (totalRows !== rowShapedLines) {
  fail(
    `Read ${totalRows} rows but the file has ${rowShapedLines} row-shaped ` +
      `lines; refusing to convert.`,
  );
}

// A header repeated in the source would become two pages for the same
// division and stage, and the importer would read every row twice.
const seenSections = new Set<string>();
for (const section of sections) {
  const where = `${section.division} / ${section.stageLabel}`;
  const key = `${section.division}#${section.stageNumber}`;
  if (seenSections.has(key)) fail(`Section appears twice: ${where}`);
  seenSections.add(key);
  if (section.rows.length === 0) fail(`Section with no rows: ${where}`);
  // Ties repeat a place, so the ranking may stall but never go back.
  let previous = 0;
  for (const row of section.rows) {
    const place = parseInt(row, 10);
    if (previous === 0 ? place !== 1 : place < previous) {
      fail(`Places out of order in ${where}: ${previous} then ${place}.`);
    }
    previous = place;
  }
}

// The output uses a standard font with WinAnsiEncoding and writes each string
// as Latin-1 bytes; anything outside that range would come out as another
// character.
const unencodable = new Set<string>();
for (const text of [title, printedLine, ...sections.flatMap((s) => s.rows)]) {
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code > 0xff || (code >= 0x80 && code <= 0x9f)) unencodable.add(ch);
  }
}
if (unencodable.size > 0) {
  fail(
    `Characters outside Latin-1 cannot be written: ` +
      `${[...unencodable].join(" ")}`,
  );
}

// ---- PDF -------------------------------------------------------------------
//
// Written by hand: the repo has no PDF library, and the parser only needs
// each line to be one text run at its own height. One section per page, with
// the page as tall as its rows, so no section ever needs a continuation page.

const FONT_SIZE = 9;
const LEADING = 13;
const MARGIN = 36;
const PAGE_WIDTH = 842;
// Largest page side the PDF specification allows, in points.
const MAX_PAGE_HEIGHT = 14400;

const escapePdfString = (text: string) =>
  text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

const footerLine = (pageNumber: number) =>
  `${printedLine.replace(/^Printed:/, "Printed")} ` +
  `ESS - Electronic Scoring System ${pageNumber} of ${sections.length}`;

/** Object bodies; the object number is the index plus one. */
const objects: string[] = [];
const addObject = (body: string) => objects.push(body);

const catalogId = addObject("");
const pageTreeId = addObject("");
const fontId = addObject(
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
);
const pageIds: number[] = [];

sections.forEach((section, index) => {
  const lines = [
    title,
    printedLine,
    `${section.division} - Results by Stage`,
    section.stageLabel,
    COLUMNS_LINE,
    ...section.rows,
    footerLine(index + 1),
  ];
  const height = MARGIN * 2 + lines.length * LEADING;
  if (height > MAX_PAGE_HEIGHT) {
    fail(
      `${section.division} / ${section.stageLabel} has ${section.rows.length} ` +
        `rows, too many for a single page.`,
    );
  }
  let stream = `BT\n/F1 ${FONT_SIZE} Tf\n`;
  lines.forEach((line, n) => {
    const y = height - MARGIN - (n + 1) * LEADING;
    stream += `1 0 0 1 ${MARGIN} ${y} Tm (${escapePdfString(line)}) Tj\n`;
  });
  stream += "ET";
  const contentId = addObject(
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
  );
  pageIds.push(
    addObject(
      `<< /Type /Page /Parent ${pageTreeId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${height}] ` +
        `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    ),
  );
});

objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pageTreeId} 0 R >>`;
objects[pageTreeId - 1] =
  `<< /Type /Pages /Count ${pageIds.length} ` +
  `/Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;

const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
const offsets: number[] = [];
let position = chunks[0]!.length;
objects.forEach((body, index) => {
  offsets.push(position);
  const chunk = Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, "latin1");
  chunks.push(chunk);
  position += chunk.length;
});
let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const offset of offsets) {
  xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
}
xref +=
  `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n` +
  `startxref\n${position}\n%%EOF\n`;
chunks.push(Buffer.from(xref, "latin1"));

const pdf = Buffer.concat(chunks);

// ---- read the PDF back through the parser, then write it -------------------

const expectedStages = new Set(sections.map((s) => s.stageNumber)).size;

let parsed: Awaited<ReturnType<typeof parsePdf>>;
let overall: Awaited<ReturnType<typeof parsePdf>>;
try {
  parsed = await parsePdf(new Uint8Array(pdf), outPath);
  overall = await parsePdf(new Uint8Array(await readFile(overallPath)), overallPath);
} catch (error) {
  fail(
    `The parser rejects the generated PDF or the overall: ` +
      `${error instanceof Error ? error.message : error}`,
  );
}

const parsedRows = parsed.stages.reduce((sum, s) => sum + s.results.length, 0);
const rowsPerStage = [...new Set(parsed.stages.map((s) => s.results.length))];
const divisionsPerStage = [
  ...new Set(
    parsed.stages.map((stage) => {
      const counts = new Map<string, number>();
      for (const result of stage.results) {
        counts.set(result.divisionCode, (counts.get(result.divisionCode) ?? 0) + 1);
      }
      return [...counts].map(([code, count]) => `${code} ${count}`).join(", ");
    }),
  ),
];

console.log(`Converted ${webPrintPath}`);
console.log(`  source:        ${parsed.source}`);
console.log(`  match:         ${parsed.name}`);
console.log(`  date:          ${parsed.date}`);
console.log(`  stages:        ${parsed.stages.length}`);
console.log(`  rows:          ${parsedRows} (per stage: ${rowsPerStage.join(", ")})`);
for (const counts of divisionsPerStage) {
  console.log(`  per division:  ${counts}`);
}

if (parsed.stages.length !== expectedStages || parsedRows !== totalRows) {
  fail(
    `The parser read ${parsed.stages.length} stages and ${parsedRows} rows from ` +
      `the output; the source has ${expectedStages} stages and ${totalRows} rows.`,
  );
}
if (parsed.name !== overall.name || parsed.date !== overall.date) {
  fail(
    `The output parses as "${parsed.name}" (${parsed.date}) but the overall as ` +
      `"${overall.name}" (${overall.date}); the stages would not attach to it.`,
  );
}

try {
  await writeFile(outPath, pdf);
} catch (error) {
  fail(`Cannot write ${outPath}: ${error instanceof Error ? error.message : error}`);
}
console.log(`Wrote ${outPath} (${sections.length} pages, ${pdf.length} bytes)`);
