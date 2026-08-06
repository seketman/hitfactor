import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Locale } from "@/i18n/routing";

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
 * por fila de tabla. Memoizamos por locale — son dos, así que el Map no
 * crece.
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
    });
    DATE_FORMATTERS.set(locale, fmt);
  }
  return fmt;
}

function dateTimeFormatter(locale: Locale): Intl.DateTimeFormat {
  let fmt = DATE_TIME_FORMATTERS.get(locale);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, {
      dateStyle: "short",
      timeStyle: "short",
    });
    DATE_TIME_FORMATTERS.set(locale, fmt);
  }
  return fmt;
}

/**
 * Formatea una fecha de calendario (`YYYY-MM-DD`) según el locale.
 *
 * Tolera que le pasen un timestamp completo: usa los primeros 10 caracteres.
 *
 * **Ojo con el timezone.** La fecha se construye con `new Date(y, m-1, d)`
 * (medianoche *local*), NO con `new Date(iso)`. `new Date("2026-08-06")` se
 * interpreta como medianoche **UTC**, y en cualquier timezone al oeste de
 * Greenwich —Argentina entre ellas— eso cae el día anterior: se renderiza
 * "05/08/2026". Sería un off-by-one en todas las fechas de la app. Hay un
 * test que fija esto (`tests/format-date.test.ts`).
 */
export function formatDate(
  iso: string | null | undefined,
  locale: Locale,
): string {
  if (!iso) return "—";
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!parts) return iso;
  const [, y, m, d] = parts;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return iso;
  return dateFormatter(locale).format(date);
}

/**
 * Formatea un timestamp (instante real, con hora) según el locale.
 *
 * A diferencia de `formatDate`, acá `new Date(iso)` **sí** es correcto: el
 * input es un instante, no una fecha de calendario.
 *
 * Limitación conocida: se renderiza en el timezone del *proceso*, que en
 * Vercel es UTC. Un usuario argentino ve las horas corridas 3 hs. Es un eje
 * distinto del locale y se arregla aparte.
 */
export function formatDateTime(
  iso: string | null | undefined,
  locale: Locale,
): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return dateTimeFormatter(locale).format(date);
}
