/**
 * Resolución de la URL absoluta del sitio.
 *
 * Fuente de verdad para toda la metadata SEO (canonical, sitemap, robots,
 * Open Graph, JSON-LD). El valor viene de `NEXT_PUBLIC_SITE_URL`; si no está
 * definida, se asume el entorno local.
 */

const DEFAULT_SITE_URL = "http://localhost:3000";

/**
 * Devuelve la URL base del sitio, normalizada (trim, sin trailing slash).
 * Hace fallback a `http://localhost:3000` si la variable no está seteada o
 * está vacía.
 */
export function getSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) {
    return DEFAULT_SITE_URL;
  }
  return raw.replace(/\/+$/, "");
}

/**
 * Concatena un path relativo con la URL base, garantizando un único `/` de
 * separación. `absoluteUrl("/")` devuelve el site URL con un slash final.
 */
export function absoluteUrl(path: string): string {
  const base = getSiteUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}
