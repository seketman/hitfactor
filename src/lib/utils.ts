import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge de clases Tailwind con resolución de conflictos.
 * Uso: cn("p-4", condition && "p-2") → la última gana.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formatea un porcentaje (0-100) con 2 decimales y signo de %. */
export function formatPercent(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}%`;
}

/** Formatea un número con N decimales y tabular nums. */
export function formatNumber(
  value: number | string | null | undefined,
  decimals = 2,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(decimals);
}

/** Formatea una fecha ISO (YYYY-MM-DD) en formato legible es-AR. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  // Construimos manualmente para evitar timezone shift de new Date(iso)
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

/** Formatea timestamp en local string. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}
