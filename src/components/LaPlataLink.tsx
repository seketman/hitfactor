"use client";

import { type ReactNode } from "react";
import { useLocale } from "next-intl";
import type { Locale } from "@/i18n/routing";

/**
 * Keyed by `Locale`, not `string`, so the compiler asks for the article when
 * a locale is added. Typed loosely this silently fell back to the English
 * page — a new locale would have shipped a wrong-language link with nothing
 * failing anywhere.
 */
const WIKIPEDIA_URL: Record<Locale, string> = {
  es: "https://es.wikipedia.org/wiki/La_Plata",
  en: "https://en.wikipedia.org/wiki/La_Plata",
};

/**
 * Envuelve una mención a la ciudad de La Plata (Buenos Aires, Argentina) con
 * un enlace a su página de Wikipedia, en el idioma activo, abierto en otra
 * pestaña. `rel="noopener noreferrer"` por seguridad al usar target="_blank".
 */
export function LaPlataLink({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const href = WIKIPEDIA_URL[locale];
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline decoration-dotted underline-offset-2 hover:text-fg"
    >
      {children}
    </a>
  );
}
