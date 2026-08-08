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
  cause?: ErrorCause,
): never {
  if (cause) {
    // `console.error` y no el mensaje al usuario: acá va lo que sirve para
    // diagnosticar, que es justamente lo que no puede viajar en la URL.
    console.error(
      `[action:${cause.context}] ${cause.detail ?? "(sin detalle)"}`,
    );
  }
  redirect({ href: { pathname: path, query: { error: message } }, locale });
}

/**
 * Detalle técnico de una falla: va a los logs del server, nunca al usuario.
 *
 * Existe porque el patrón anterior era meter el error crudo de
 * PostgREST/GoTrue en el mensaje —a veces suelto, a veces interpolado en un
 * `{error}` dentro de una frase traducida— y eso terminaba en la URL del
 * usuario, en su historial de browser y en cualquier referrer. Nombres de
 * constraints, de columnas y de policies. Ver issue #199.
 *
 * Es un parámetro de `redirectWithError` y no un `console.error` suelto en
 * cada call-site a propósito: el momento en que se descarta el detalle es
 * exactamente el momento en que hay que registrarlo. Separarlos hace fácil
 * hacer una cosa y olvidar la otra, que es como se pierde la unica copia
 * del error.
 */
export interface ErrorCause {
  /** Identificador corto de la operación, ej. `"firearm.create"`. */
  context: string;
  /** Mensaje crudo del SDK. */
  detail?: string | null;
}
