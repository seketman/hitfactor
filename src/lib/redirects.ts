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
