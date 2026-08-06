/**
 * Validación de rutas internas de la app.
 *
 * Vive aparte de `redirects.ts` a propósito: son funciones **puras**, y
 * `redirects.ts` importa los wrappers de `@/i18n/navigation`, que a su vez
 * arrastran el runtime de navegación de Next. Con todo en un archivo, un test
 * de `isInternalAppPath` no puede correr sin levantar medio Next — y esto es
 * la protección contra open redirects, justo lo que más conviene poder
 * testear barato.
 */

/**
 * Whitelist de rutas internas a las que un Server Action puede redirigir
 * después de completarse (post-acción back, navegación contextual). Evita
 * open redirects y nos limita a las vistas reales que pueden originar
 * una acción.
 *
 * Rutas aceptadas:
 *  - `/matches`, `/matches/{uuid}` (incluye sub-rutas como `/me`)
 *  - `/dashboard`, `/dashboard/{discipline_code}`
 *  - `/firearms`, `/firearms/{uuid}` (incluye sub-rutas como `/qr`)
 *  - `/ammo`, `/ammo/{uuid}`
 *  - `/activity`
 *  - `/about`
 *
 * No aceptamos query strings ni fragmentos — son responsabilidad del caller
 * agregarlos si los necesita.
 *
 * **Las rutas van SIN prefijo de locale.** `/matches`, no `/es/matches`. Los
 * wrappers de `@/i18n/navigation` reciben el path lógico y agregan el prefijo
 * ellos, así que el prefijo nunca llega hasta acá. Si alguien empieza a pasar
 * rutas prefijadas, esta whitelist las rechaza y el usuario cae al fallback
 * — que falla seguro, pero conviene saber por qué.
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
    /^\/firearms\/[A-Za-z0-9-]+(\/[a-z]+)?$/.test(value) ||
    /^\/ammo$/.test(value) ||
    /^\/ammo\/[A-Za-z0-9-]+$/.test(value) ||
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
