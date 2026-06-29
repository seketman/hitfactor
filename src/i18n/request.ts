import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

/**
 * Carga los mensajes del locale activo para cada request (Server Components).
 * Si el locale del segmento `[locale]` no es válido, cae al `defaultLocale`
 * (el layout además dispara `notFound()` para esos casos).
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
