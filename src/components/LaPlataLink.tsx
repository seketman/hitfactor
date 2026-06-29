"use client";

import { type ReactNode } from "react";
import { useLocale } from "next-intl";

/**
 * Envuelve una mención a la ciudad de La Plata (Buenos Aires, Argentina) con
 * un enlace a su página de Wikipedia, en el idioma activo, abierto en otra
 * pestaña. `rel="noopener noreferrer"` por seguridad al usar target="_blank".
 */
const WIKIPEDIA_URL: Record<string, string> = {
  es: "https://es.wikipedia.org/wiki/La_Plata",
  en: "https://en.wikipedia.org/wiki/La_Plata",
};

export function LaPlataLink({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const href = WIKIPEDIA_URL[locale] ?? WIKIPEDIA_URL.en;
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
