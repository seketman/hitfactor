import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * `formatDate` / `formatDateTime` no tenían ningún test. Se los agrega junto
 * con el fix de locale (#149) porque los dos comportamientos que hay que
 * proteger acá son silenciosos: si se rompen, la app no falla — muestra otra
 * fecha.
 */

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

/**
 * Importa `utils` con el timezone del proceso forzado.
 *
 * Hace falta `resetModules` porque el módulo memoiza los `Intl.DateTimeFormat`
 * en un Map, y un formatter resuelve su timezone en el momento de
 * construirse: reusar el del test anterior mediría el TZ viejo.
 */
async function utilsInTimeZone(tz: string) {
  process.env.TZ = tz;
  vi.resetModules();
  return import("@/lib/utils");
}

/**
 * El bug que este bloque protege: construir la fecha con `new Date(iso)` en
 * vez de `new Date(y, m-1, d)`. `new Date("2026-08-06")` es medianoche
 * **UTC**, así que al oeste de Greenwich cae el día anterior y toda la app
 * muestra las fechas corridas un día.
 *
 * Se prueba en tres timezones a propósito: en UTC —donde corre el CI— el bug
 * NO se manifiesta, así que un test que solo corriera ahí daría verde con el
 * código roto.
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
