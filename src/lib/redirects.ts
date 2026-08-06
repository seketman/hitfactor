import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

/**
 * Server-side redirect a `path` con un mensaje de error en el querystring,
 * preservando el locale activo.
 *
 * Convención de la app: las páginas reciben `searchParams.error` y lo
 * muestran en un Alert. Este helper centraliza el armado del query y evita
 * que cada Server Action haga su propio `encodeURIComponent`.
 *
 * Devuelve `never` porque `redirect()` lanza una excepción especial de Next.
 *
 * **`locale` es un parámetro, no un `await getLocale()` acá adentro.** Sacarlo
 * del contexto haría falta volver la función `async`, y ahí el `never` se
 * convierte en `Promise<never>`: un call-site que se olvide del `await` no
 * falla a compilar, la excepción del redirect queda en una promesa colgada, y
 * la acción sigue de largo como si nada. Con el locale explícito la función
 * queda sync, el `never` se mantiene, y el compilador marca todos los
 * call-sites cuando la firma cambia.
 *
 * Uso:
 *   const locale = await getLocale();
 *   redirectWithError("/firearms", "Falta el nombre", locale);
 *   // → /es/firearms?error=Falta%20el%20nombre
 */
export function redirectWithError(
  path: string,
  message: string,
  locale: Locale,
): never {
  redirect({ href: { pathname: path, query: { error: message } }, locale });
}
