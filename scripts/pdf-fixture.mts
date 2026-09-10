/**
 * Prints the text of a PDF exactly as the parsers receive it.
 *
 * The inline fixtures in `tests/*-pdf.test.ts` are not "the text of the PDF".
 * They are trimmed and anonymized from the output of `extractPdfPages`, which
 * reorders the pdfjs items by position (Y, then X) so the visual layout
 * wins. Text from any other source — a viewer's copy-paste, `pdftotext`, an
 * attachment dump — comes out in the order the strings happen to sit in the
 * PDF's content stream, which is often close enough to look right while
 * feeding the parser different rows.
 *
 * That failure is silent: the parser does not complain about a bad fixture, it
 * misbehaves as if it had a bug. See #298 and #296.
 *
 * Usage:
 *   npm run pdf:fixture -- path/to/file.pdf          # plain text, per page
 *   npm run pdf:fixture -- path/to/file.pdf --ts     # paste-ready TS literals
 *
 * Run it once per PDF; multi-file formats (Steel Challenge) get one fixture
 * per file, same as the parser gets one upload per file.
 */

import { readFile } from "node:fs/promises";

import {
  extractPdfPages,
  type PdfPage,
} from "../src/lib/parsers/pdf-extract.ts";

const USAGE = `Usage: npm run pdf:fixture -- <file.pdf> [--ts]

  --ts   emit "const pageNText = \`...\`;" instead of plain text

For a file whose name starts with a dash, end the options first:
  npm run pdf:fixture -- -- -weird.pdf

Output goes to stdout and is byte-faithful to what the parser receives:
no added indentation, no surrounding blank lines inside the literal.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Escapes the three sequences that would break out of a template literal. */
function escapeForTemplateLiteral(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
}

const args = process.argv.slice(2);

// Everything after a "--" is a literal path, so a file whose name starts with
// a dash is still reachable. npm eats the first "--", hence the doubled one
// shown in USAGE.
const separatorAt = args.indexOf("--");
const optionArgs = separatorAt === -1 ? args : args.slice(0, separatorAt);
const literalPaths = separatorAt === -1 ? [] : args.slice(separatorAt + 1);

const flags = optionArgs.filter((arg) => arg.startsWith("-"));
const paths = [
  ...optionArgs.filter((arg) => !arg.startsWith("-")),
  ...literalPaths,
];

const unknownFlags = flags.filter((flag) => flag !== "--ts");
if (unknownFlags.length > 0) {
  fail(`Unknown option: ${unknownFlags.join(", ")}\n\n${USAGE}`);
}
if (paths.length !== 1) {
  fail(USAGE);
}

const pdfPath = paths[0];
const asTypeScript = flags.includes("--ts");

let data: Uint8Array;
try {
  data = new Uint8Array(await readFile(pdfPath));
} catch (error) {
  fail(`Cannot read ${pdfPath}: ${error instanceof Error ? error.message : error}`);
}

// `extractPdfPages` logs a timing line to stdout. Here stdout IS the fixture,
// and a stray line inside a redirected fixture is the exact class of silent
// corruption this script exists to prevent, so the log goes to stderr instead.
const realLog = console.log;
console.log = (...logArgs: unknown[]) => console.error(...logArgs);

let pages: PdfPage[];
try {
  pages = await extractPdfPages(data);
} catch (error) {
  fail(
    `Failed to extract text from ${pdfPath}: ` +
      `${error instanceof Error ? error.message : error}`,
  );
} finally {
  console.log = realLog;
}

if (pages.length === 0) {
  fail(`${pdfPath} produced no pages — refusing to emit an empty fixture.`);
}

for (const page of pages) {
  if (asTypeScript) {
    process.stdout.write(
      `const page${page.num}Text = \`${escapeForTemplateLiteral(page.text)}\`;\n\n`,
    );
  } else {
    process.stdout.write(`=== page ${page.num} of ${pages.length} ===\n`);
    process.stdout.write(`${page.text}\n\n`);
  }
}
