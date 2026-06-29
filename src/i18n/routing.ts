import { defineRouting } from "next-intl/routing";

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
