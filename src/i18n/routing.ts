import { defineRouting } from "next-intl/routing";
import { hasLocale } from "next-intl";

/**
 * Configuración de routing i18n (next-intl).
 *
 *  - `locales`: la lista de idiomas servidos. De acá la derivan hreflang,
 *    el sitemap, los catálogos y sus guardrails. El switcher itera esta
 *    lista pero sus etiquetas (`LABELS`) siguen siendo un mapa a mano —
 *    igual que `WIKIPEDIA_URL`—, tipado `Record<Locale, …>` para que el
 *    compilador exija la entrada nueva en vez de servir un default.
 *  - `defaultLocale: "es"`: el idioma original de la app; se usa como fallback.
 *  - `localePrefix: "always"`: todos los idiomas van con prefijo en la URL
 *    (`/es/...`, `/en/...`, `/pt-BR/...`). La raíz `/` redirige al locale
 *    detectado.
 *  - `localeDetection: true`: para visitantes nuevos sin cookie, next-intl elige
 *    el locale por el header `Accept-Language` del browser. El switcher de la UI
 *    persiste la elección en la cookie `NEXT_LOCALE`.
 */
export const routing = defineRouting({
  locales: ["es", "en", "pt-BR"],
  defaultLocale: "es",
  localePrefix: "always",
  localeDetection: true,
});

export type Locale = (typeof routing.locales)[number];

/**
 * The `alternates.languages` map for a page that exists at `/<locale><path>`.
 *
 * Derived rather than written out. Both call sites held a literal
 * `{ es: "/es", en: "/en" }`, so a new locale shipped with no hreflang of its
 * own and nothing failed — and two copies of the same literal drift one at a
 * time. `sitemap.ts` builds absolute URLs and keeps its own version.
 */
export function localeAlternates(path = ""): Record<Locale, string> {
  return Object.fromEntries(
    routing.locales.map((locale) => [locale, `/${locale}${path}`]),
  ) as Record<Locale, string>;
}

/**
 * Estrecha el segmento `[locale]` de la URL a un `Locale`, cayendo al default
 * si no se reconoce.
 *
 * Hace falta porque los tipos de ruta que genera Next salen de la estructura
 * de directorios: `params.locale` es `string` y no hay forma de que Next sepa
 * qué locales existen. El estrechamiento va sí o sí en runtime.
 *
 * **Ojo: esto NO es el guard de "locale inválido".** Ese vive en
 * `[locale]/layout.tsx`, que hace `notFound()`. Este helper es para los
 * lugares que corren *antes* o *al margen* de ese guard —`generateMetadata` y
 * `i18n/request.ts`— donde tirar 404 no es una opción y hay que producir algo.
 * Que devuelvan el default no contradice al 404: la metadata de una ruta que
 * después va a 404ear no se sirve nunca.
 */
export function resolveLocale(requested: string | undefined): Locale {
  return hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;
}
