import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * `formatDate` / `formatDateTime` no tenían ningún test. Se los agrega junto
 * con el fix de locale (#149) porque los dos comportamientos que hay que
 * proteger acá son silenciosos: si se rompen, la app no falla — muestra otra
 * fecha.
 */

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  // `process.env.TZ = undefined` NO borra la variable: Node la coacciona al
  // string "undefined", y a partir de ahí `Intl` resuelve el timezone a
  // `undefined` en ese proceso. Como `TZ` no está seteada ni en local ni en
  // el CI, el caso normal es justamente ése, así que sin el `delete` este
  // cleanup corrompía el timezone en vez de restaurarlo.
  //
  // Hoy no se propaga a otros archivos porque vitest los aísla por defecto,
  // pero eso es una config, no una garantía: alcanza con `isolate: false`
  // para que empiece a hacerlo, y sin ningún test en rojo que lo delate.
  if (ORIGINAL_TZ === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = ORIGINAL_TZ;
  }
});

/**
 * Importa `utils` con el timezone del proceso forzado.
 *
 * Hace falta `resetModules` porque el módulo memoiza los `Intl.DateTimeFormat`
 * en un Map, y un formatter resuelve su timezone en el momento de
 * construirse: reusar el del test anterior mediría el TZ viejo.
 *
 * **El assert del medio no es paranoia.** Escribir `process.env.TZ` solo
 * mueve el timezone efectivo cuando el runner corre en procesos de verdad
 * (`pool: "forks"`, el default de vitest y lo que fija `vitest.config.ts`).
 * Bajo `pool: "threads"` la asignación no cambia lo que resuelve `Intl` en
 * ese worker, y estos tests pasarían **sin probar nada**: como `formatDate`
 * está anclado en UTC, los tres timezones dan verde aunque la inyección no
 * haya surtido efecto. Sin este chequeo, el archivo dejaría de detectar la
 * regresión que existe para detectar, y nadie se enteraría.
 */
async function utilsInTimeZone(tz: string) {
  process.env.TZ = tz;
  vi.resetModules();
  // Se comparan instantes formateados y no nombres de zona: Node canonicaliza
  // los alias —`America/Argentina/Buenos_Aires` resuelve a
  // `America/Buenos_Aires`— así que comparar strings daría un falso negativo.
  const probe = new Date("2026-08-06T14:30:00Z");
  const opts = { dateStyle: "short", timeStyle: "short" } as const;
  const ambient = new Intl.DateTimeFormat("en", opts).format(probe);
  const wanted = new Intl.DateTimeFormat("en", { ...opts, timeZone: tz }).format(
    probe,
  );
  if (ambient !== wanted) {
    throw new Error(
      `No se pudo forzar el timezone del proceso: se pidió ${tz} (${wanted}) ` +
        `y el proceso está en ${Intl.DateTimeFormat().resolvedOptions().timeZone} ` +
        `(${ambient}). Estos tests necesitan que el runner corra en procesos ` +
        `(pool: "forks"); con pool: "threads" pasarían en verde sin validar nada.`,
    );
  }
  return import("@/lib/utils");
}

/**
 * Una fecha de calendario no tiene hora ni lugar: el 6 de agosto es el 6 de
 * agosto en cualquier timezone. `formatDate` lo garantiza anclando en UTC de
 * las dos puntas — `Date.UTC` al construir y `timeZone: "UTC"` en el
 * formatter. Este bloque protege ese par.
 *
 * **Los tres timezones no son decorativos: cada mitad rota falla en un
 * hemisferio distinto.** Si se saca el `timeZone: "UTC"` del formatter, fallan
 * los casos al oeste (Buenos Aires). Si se construye en hora local en vez de
 * `Date.UTC`, falla el del este (Tokio). Con un solo timezone, la mitad que no
 * le toca pasa en verde con el código roto — y UTC, que es donde corre el CI,
 * no detecta ninguna de las dos.
 */
describe("formatDate — no se corre de día según el timezone", () => {
  const cases: Array<[string, string]> = [
    ["UTC", "06/08/2026"],
    ["America/Argentina/Buenos_Aires", "06/08/2026"], // UTC-3
    ["Asia/Tokyo", "06/08/2026"], // UTC+9
  ];

  it.each(cases)("en %s renderiza %s", async (tz, expected) => {
    const { formatDate } = await utilsInTimeZone(tz);
    expect(formatDate("2026-08-06", "es")).toBe(expected);
  });

  // El 1 de mes es el caso donde un corrimiento negativo cambia también el
  // mes, y el 1 de enero cambia además el año.
  it("no corre el mes en un día 1", async () => {
    const { formatDate } = await utilsInTimeZone(
      "America/Argentina/Buenos_Aires",
    );
    expect(formatDate("2026-08-01", "es")).toBe("01/08/2026");
  });

  it("no corre el año en un 1 de enero", async () => {
    const { formatDate } = await utilsInTimeZone(
      "America/Argentina/Buenos_Aires",
    );
    expect(formatDate("2026-01-01", "es")).toBe("01/01/2026");
  });
});

describe("formatDate — locale", () => {
  it("en español mantiene exactamente el formato que la app ya mostraba", async () => {
    // Este assert es una guarda de regresión visual: el fix de #149 no debía
    // cambiar nada de la UI en español, solo arreglar la inglesa.
    const { formatDate } = await utilsInTimeZone("UTC");
    expect(formatDate("2026-08-06", "es")).toBe("06/08/2026");
  });

  it("en inglés usa el orden mes/día, que es el bug que se arregla", async () => {
    // Antes del fix acá salía "06/08/2026", que un lector en inglés lee como
    // 8 de junio.
    const { formatDate } = await utilsInTimeZone("UTC");
    expect(formatDate("2026-08-06", "en")).toBe("08/06/2026");
  });
});

describe("formatDate — entradas raras", () => {
  it("devuelve el guión largo para null, undefined y vacío", async () => {
    const { formatDate } = await utilsInTimeZone("UTC");
    expect(formatDate(null, "es")).toBe("—");
    expect(formatDate(undefined, "es")).toBe("—");
    expect(formatDate("", "es")).toBe("—");
  });

  it("devuelve la entrada tal cual si no tiene forma de fecha ISO", async () => {
    const { formatDate } = await utilsInTimeZone("UTC");
    expect(formatDate("no soy una fecha", "es")).toBe("no soy una fecha");
    expect(formatDate("2026-8-6", "es")).toBe("2026-8-6");
  });

  /**
   * `Date` no valida: **normaliza**. `Date.UTC(2026, 12, 45)` no tira, devuelve
   * el 14/02/2027. Sin el chequeo de round-trip, una fecha corrupta se
   * renderizaría como una fecha plausible y falsa — peor que una visiblemente
   * rota, porque nadie la cuestiona.
   */
  it("rechaza fechas que existen en el string pero no en el calendario", async () => {
    const { formatDate } = await utilsInTimeZone("UTC");
    expect(formatDate("2026-13-45", "es")).toBe("2026-13-45"); // sería 14/02/2027
    expect(formatDate("2026-02-30", "es")).toBe("2026-02-30"); // sería 02/03/2026
    expect(formatDate("2026-00-00", "es")).toBe("2026-00-00"); // sería 30/11/2025
  });

  // `Date.UTC(26, 0, 1)` es 1926: los años 0-99 se mapean a 1900-1999. El
  // round-trip lo detecta porque el año que vuelve es 1926, no 26.
  it("no cae en la semántica legacy de años de dos dígitos", async () => {
    const { formatDate } = await utilsInTimeZone("UTC");
    expect(formatDate("0026-01-01", "es")).toBe("0026-01-01");
    expect(formatDate("0000-01-01", "es")).toBe("0000-01-01");
  });

  // El 29/02 solo existe en bisiestos: es el caso donde el round-trip tiene
  // que aceptar y rechazar el mismo día según el año.
  it("acepta el 29 de febrero bisiesto y rechaza el no bisiesto", async () => {
    const { formatDate } = await utilsInTimeZone("UTC");
    expect(formatDate("2024-02-29", "es")).toBe("29/02/2024");
    expect(formatDate("2026-02-29", "es")).toBe("2026-02-29");
  });

  // El sidebar le pasa `user.created_at`, que es un timestamp completo.
  it("tolera un timestamp completo y usa su parte de fecha", async () => {
    const { formatDate } = await utilsInTimeZone("UTC");
    expect(formatDate("2026-08-06T14:30:00Z", "es")).toBe("06/08/2026");
  });
});

describe("formatDateTime", () => {
  // Se fija el timezone porque esta función SÍ depende del TZ del proceso:
  // el input es un instante, no una fecha de calendario.
  it("respeta el locale", async () => {
    const { formatDateTime } = await utilsInTimeZone("UTC");
    expect(formatDateTime("2026-08-06T14:30:00Z", "es")).toBe("6/8/26, 14:30");
    expect(formatDateTime("2026-08-06T14:30:00Z", "en")).toBe(
      "8/6/26, 2:30 PM",
    );
  });

  it("renderiza en el timezone del proceso", async () => {
    // Documenta la limitación conocida: en Vercel el proceso corre en UTC,
    // así que un usuario argentino ve las horas corridas 3 hs.
    const { formatDateTime } = await utilsInTimeZone(
      "America/Argentina/Buenos_Aires",
    );
    expect(formatDateTime("2026-08-06T02:00:00Z", "es")).toBe("5/8/26, 23:00");
  });

  it("devuelve el guión largo para null y para basura", async () => {
    const { formatDateTime } = await utilsInTimeZone("UTC");
    expect(formatDateTime(null, "es")).toBe("—");
    expect(formatDateTime("no soy un timestamp", "es")).toBe("—");
  });
});
