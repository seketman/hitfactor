import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La tabla de migraciones de `docs/development.md` es la guía para levantar
 * la DB de cero. Estuvo cortada en la 0002 mientras el directorio llegaba a
 * la 0020 — o sea que seguir el doc al pie de la letra te dejaba una base
 * incompleta, y el modo de falla es silencioso: no explota al aplicarla,
 * explota semanas después cuando usás la feature que falta.
 *
 * Nada lo verificaba, y por eso se desincronizó 18 veces seguidas. Este
 * test es esa verificación.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");
const DOC_PATH = join(process.cwd(), "docs/development.md");

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function doc(): string {
  return readFileSync(DOC_PATH, "utf8");
}

describe("tabla de migraciones en docs/development.md", () => {
  it("documenta todas las migraciones del directorio", () => {
    const text = doc();
    const undocumented = migrationFiles().filter((f) => !text.includes(f));

    expect(
      undocumented,
      `Faltan filas en la tabla de docs/development.md para: ${undocumented.join(", ")}. ` +
        "Agregá una fila por archivo (ver las existentes como modelo).",
    ).toEqual([]);
  });

  it("no referencia migraciones que ya no existen", () => {
    const files = new Set(migrationFiles());
    // Solo miramos los links a la carpeta de migraciones, no cualquier
    // mención suelta de un número.
    const referenced = [
      ...doc().matchAll(/\.\.\/supabase\/migrations\/([\w.-]+\.sql)/g),
    ].map((m) => m[1]!);

    const dangling = [...new Set(referenced)].filter((f) => !files.has(f));

    expect(
      dangling,
      `El doc linkea migraciones inexistentes: ${dangling.join(", ")}.`,
    ).toEqual([]);
  });

  it("no deja huecos en la numeración", () => {
    // Un salto (0007 → 0009) casi siempre significa que un archivo se
    // renombró o se perdió en un merge. Aplicar la serie con un hueco deja
    // la base en un estado que nadie probó.
    const numbers = migrationFiles()
      .map((f) => Number(/^(\d+)/.exec(f)?.[1] ?? NaN))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);

    const gaps: number[] = [];
    for (let i = 1; i < numbers.length; i++) {
      const prev = numbers[i - 1]!;
      const cur = numbers[i]!;
      for (let missing = prev + 1; missing < cur; missing++) {
        gaps.push(missing);
      }
    }

    expect(gaps, `Faltan las migraciones: ${gaps.join(", ")}.`).toEqual([]);
  });
});
