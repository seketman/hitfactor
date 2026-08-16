import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Locale } from "@/i18n/routing";
import { parseIsoDateUtc } from "@/lib/dates";

/**
 * Merge de clases Tailwind con resolución de conflictos.
 * Uso: cn("p-4", condition && "p-2") → la última gana.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formatea un porcentaje (0-100) con 2 decimales y signo de %.
 *
 * **Deliberadamente NO es locale-aware.** Ver la nota de `formatNumber`.
 */
export function formatPercent(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}%`;
}

/**
 * Formatea un número con N decimales y tabular nums.
 *
 * **Deliberadamente NO es locale-aware**, a diferencia de las fechas. Estos
 * números son puntajes (hit factor, porcentajes, tiempos) que el usuario
 * compara contra el reporte de PractiScore o WinMSS que tiene al lado, y
 * esos reportes usan punto decimal siempre. Un hit factor mostrado como
 * "2,75" junto a un PDF que dice "2.75" genera duda sobre si es el mismo
 * dato. Las fechas son prosa; los puntajes son datos que se cotejan.
 */
export function formatNumber(
  value: number | string | null | undefined,
  decimals = 2,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(decimals);
}

/**
 * Construir un `Intl.DateTimeFormat` es caro y estas funciones corren una vez
 * por fila de tabla. Memoizamos por locale — son los de `routing.locales`,
 * un puñado acotado, así que el Map no crece sin control.
 *
 * `DATE_TIME_FORMATTERS` se indexa además por time zone (#190), así que ése
 * sí puede crecer: una entrada por par (locale, zona) que la app haya visto.
 * Queda acotado porque el único origen de zonas es `getRequestTimeZone()`,
 * que valida contra la base IANA antes de devolver — unos cientos de valores
 * posibles, no los que se le ocurran a un cliente. Ver `lib/timezone.ts`.
 */
const DATE_FORMATTERS = new Map<string, Intl.DateTimeFormat>();
const DATE_TIME_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(locale: Locale): Intl.DateTimeFormat {
  let fmt = DATE_FORMATTERS.get(locale);
  if (!fmt) {
    // `2-digit` en vez de `dateStyle: "short"` a propósito: short da "6/8/26"
    // y perdemos el cero a la izquierda y el año completo. Con esta config
    // el output en `es` es "06/08/2026", byte por byte igual al que la app
    // venía mostrando, así que la UI en español no cambia. En `en` da
    // "08/06/2026", que es lo que este fix viene a arreglar.
    fmt = new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      // Fijado a UTC junto con `Date.UTC` en `formatDate`. Ver la nota ahí.
      timeZone: "UTC",
    });
    DATE_FORMATTERS.set(locale, fmt);
  }
  return fmt;
}

function dateTimeFormatter(
  locale: Locale,
  timeZone: string,
): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone}`;
  let fmt = DATE_TIME_FORMATTERS.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, {
      dateStyle: "short",
      timeStyle: "short",
      timeZone,
    });
    DATE_TIME_FORMATTERS.set(key, fmt);
  }
  return fmt;
}

/**
 * Formatea una fecha de calendario (`YYYY-MM-DD`) según el locale.
 *
 * Tolera que le pasen un timestamp completo: usa los primeros 10 caracteres.
 *
 * **Ojo con el timezone.** Una fecha de calendario no tiene hora ni lugar: el
 * 6 de agosto es el 6 de agosto en Tokio y en Buenos Aires. Para que el
 * render no dependa del timezone del proceso, la fecha se ancla en UTC
 * (`Date.UTC`) **y** el formatter se fija en UTC. Las dos mitades tienen que
 * ir juntas: mezclarlas —construir en UTC y formatear en local, que es lo que
 * pasa si se usa `new Date(iso)` con un formatter sin `timeZone`— corre la
 * fecha un día al oeste de Greenwich, y sería un off-by-one en toda la app.
 *
 * Es el mismo criterio que ya usaba `lib/stats/shooter-stats.ts` para la
 * aritmética de cadencia. `tests/format-date.test.ts` lo verifica en tres
 * timezones.
 *
 * **Ante entrada inválida devuelve el string original, no "—"** (que es lo
 * que hace `formatDateTime`). La asimetría es deliberada: acá el input viene
 * de una columna `date` de la DB, así que un valor que no parsea significa
 * que algo se escribió mal en el import. Mostrarlo crudo deja el dato roto a
 * la vista para poder rastrearlo; taparlo con "—" lo vuelve indistinguible
 * de un campo vacío legítimo.
 */
export function formatDate(
  iso: string | null | undefined,
  locale: Locale,
): string {
  if (!iso) return "—";
  // `slice(0, 10)` es lo que tolera el timestamp completo: recorta la parte
  // de fecha y deja que el parser exija el formato estricto sobre ella. Un
  // input más corto o mal formado no llega a los 10 caracteres válidos y el
  // parser lo rechaza, que es como devolvemos la entrada cruda.
  const date = parseIsoDateUtc(iso.slice(0, 10));
  if (!date) return iso;
  return dateFormatter(locale).format(date);
}

/**
 * Formatea un timestamp (instante real, con hora) según el locale.
 *
 * A diferencia de `formatDate`, acá `new Date(iso)` **sí** es correcto: el
 * input es un instante, no una fecha de calendario.
 *
 * **Ante entrada inválida devuelve "—", no el string original** (al revés que
 * `formatDate`). Acá el input es un timestamp que puede venir de cualquier
 * lado, no de una columna `date`, así que un string arbitrario no es señal de
 * corrupción de datos y no aporta mostrarlo crudo en la UI.
 *
 * `timeZone` es obligatorio por la misma razón por la que `locale` lo es
 * desde #149: es lo que obliga al compilador a enumerar los call sites en vez
 * de que el default lo decida el ambiente. Un default —el timezone del
 * proceso, que en Vercel es UTC— era exactamente el bug de #190: un usuario
 * argentino veía todas las horas corridas 3 hs y nada fallaba. El valor sale
 * de `getRequestTimeZone()` (`lib/timezone.ts`).
 *
 * **Una zona inválida tira `RangeError`.** Es deliberado: la validación vive
 * en `getRequestTimeZone()`, que es donde entra input no confiable. Pasado
 * ese borde, una zona que no existe es un error de programación, y tapar eso
 * cayendo a UTC lo volvería otro bug silencioso de la misma familia que este
 * fix vino a cerrar.
 *
 * A diferencia de `formatDate`, acá el timezone SÍ corresponde aplicarlo: un
 * instante ocurrió a una hora distinta según dónde estés parado. Una fecha de
 * calendario no.
 */
export function formatDateTime(
  iso: string | null | undefined,
  locale: Locale,
  timeZone: string,
): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return dateTimeFormatter(locale, timeZone).format(date);
}
