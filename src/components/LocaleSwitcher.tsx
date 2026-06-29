"use client";

import { useParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils";
import { routing, type Locale } from "@/i18n/routing";
import { usePathname, useRouter } from "@/i18n/navigation";

const LABELS: Record<Locale, string> = {
  es: "ES",
  en: "EN",
};

/**
 * Selector de idioma (es/en). Navega al mismo path en el otro locale usando
 * los wrappers locale-aware de next-intl, que además persisten la elección en
 * la cookie `NEXT_LOCALE` — así sobrevive a recargas y futuras visitas.
 *
 * Mismo lenguaje visual que `ThemeToggle` (radiogroup de botones chicos).
 * `stretch`: ocupa todo el ancho del contenedor (útil en el sidebar).
 */
export function LocaleSwitcher({
  className,
  stretch = false,
}: {
  className?: string;
  stretch?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useParams();
  const [isPending, startTransition] = useTransition();
  const active = (params.locale as Locale) ?? routing.defaultLocale;

  return (
    <div
      role="radiogroup"
      aria-label="Idioma / Language"
      className={cn(
        "items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5",
        stretch ? "flex w-full" : "inline-flex",
        className,
      )}
    >
      {routing.locales.map((locale) => {
        const isActive = active === locale;
        return (
          <button
            key={locale}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={LABELS[locale]}
            disabled={isPending || isActive}
            onClick={() =>
              startTransition(() => {
                // Navega al MISMO path en el otro locale; next-intl persiste
                // la cookie NEXT_LOCALE.
                router.replace(pathname, { locale });
              })
            }
            className={cn(
              "inline-flex h-7 items-center justify-center rounded px-2 text-xs font-medium transition-colors",
              stretch ? "flex-1" : "",
              isActive
                ? "bg-surface text-fg shadow-sm"
                : "text-fg-muted hover:text-fg",
            )}
          >
            {LABELS[locale]}
          </button>
        );
      })}
    </div>
  );
}
