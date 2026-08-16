import type { routing } from "@/i18n/routing";

/**
 * Augmentación de tipos de next-intl.
 *
 * Sin esto, `useLocale()` y `getLocale()` devuelven `string` a secas: la
 * `Locale` de use-intl es un tipo condicional que cae a `string` mientras
 * `AppConfig` no declare el suyo. El resultado era que cualquier función que
 * pidiera un locale tipado —`formatDate`, por ejemplo— obligaba a castear en
 * cada call-site, y un `formatDate(x, "pt")` compilaba sin chistar.
 *
 * Declarando `Locale` acá, los helpers de next-intl devuelven la unión de `routing.locales`
 * en toda la app y el compilador rechaza cualquier otro locale.
 */
// Se augmenta `use-intl` y no `next-intl` a propósito: la interfaz vive en
// `use-intl/core`, y los helpers de next-intl (`getLocale`, `useLocale`)
// importan su `Locale` desde ahí. Augmentar `next-intl` —que es lo que uno
// probaría primero, porque es el paquete que la app importa— alcanza solo a
// una parte de los call-sites y deja el resto en `string`.
declare module "use-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
  }
}
