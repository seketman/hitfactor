import { getRequestConfig } from "next-intl/server";
import { resolveLocale } from "./routing";

/**
 * Carga los mensajes del locale activo para cada request (Server Components).
 * Si el locale del segmento `[locale]` no es válido, cae al `defaultLocale`
 * (el layout además dispara `notFound()` para esos casos).
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const locale = resolveLocale(await requestLocale);

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
