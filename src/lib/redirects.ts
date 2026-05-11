import { redirect } from "next/navigation";

/**
 * Server-side redirect a `path` con un mensaje de error en el querystring.
 *
 * Convención de la app: las páginas reciben `searchParams.error` y lo
 * muestran en un Alert. Este helper centraliza el encoding y evita que
 * cada Server Action haga su propio `encodeURIComponent`.
 *
 * Devuelve `never` porque `redirect()` lanza una excepción especial de Next.
 *
 * Uso:
 *   redirectWithError("/firearms", "Falta el nombre");
 *   // → /firearms?error=Falta%20el%20nombre
 */
export function redirectWithError(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

/**
 * Whitelist de rutas internas a las que un Server Action puede redirigir
 * después de completarse (post-acción back, navegación contextual). Evita
 * open redirects y nos limita a las vistas reales que pueden originar
 * una acción.
 *
 * Rutas aceptadas:
 *  - `/matches`, `/matches/{uuid}` (incluye sub-rutas como `/me`)
 *  - `/dashboard`, `/dashboard/{discipline_code}`
 *  - `/firearms`, `/firearms/{uuid}`
 *  - `/activity`
 *  - `/about`
 *
 * No aceptamos query strings ni fragmentos — son responsabilidad del caller
 * agregarlos si los necesita.
 */
export function isInternalAppPath(
  value: string | undefined | null,
): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.includes("?") || value.includes("#")) return false;
  return (
    /^\/matches$/.test(value) ||
    /^\/matches\/[A-Za-z0-9-]+(\/[a-z]+)?$/.test(value) ||
    /^\/dashboard(\/[a-z_]+)?$/.test(value) ||
    /^\/firearms$/.test(value) ||
    /^\/firearms\/[A-Za-z0-9-]+$/.test(value) ||
    /^\/activity$/.test(value) ||
    /^\/about$/.test(value)
  );
}

/**
 * Si `from` es una ruta interna válida la devuelve; sino devuelve `fallback`.
 * Útil para acciones que reciben un `from` opcional del form y necesitan
 * decidir adónde redirigir al usuario al final.
 */
export function safeBackPath(
  from: string | undefined | null,
  fallback: string,
): string {
  return isInternalAppPath(from) ? from : fallback;
}
