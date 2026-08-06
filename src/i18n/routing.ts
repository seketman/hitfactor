import { defineRouting } from "next-intl/routing";
import { hasLocale } from "next-intl";

/**
 * Configuración de routing i18n (next-intl).
 *
 *  - `locales`: español e inglés.
 *  - `defaultLocale: "es"`: el idioma original de la app; se usa como fallback.
 *  - `localePrefix: "always"`: ambos idiomas van con prefijo en la URL
 *    (`/es/...` y `/en/...`). La raíz `/` redirige al locale detectado.
 *  - `localeDetection: true`: para visitantes nuevos sin cookie, next-intl elige
 *    el locale por el header `Accept-Language` del browser. El switcher de la UI
 *    persiste la elección en la cookie `NEXT_LOCALE`.
 */
export const routing = defineRouting({
  locales: ["es", "en"],
  defaultLocale: "es",
  localePrefix: "always",
  localeDetection: true,
});

export type Locale = (typeof routing.locales)[number];

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
