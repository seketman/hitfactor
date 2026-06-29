import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo/site-url";
import { routing } from "@/i18n/routing";

/**
 * Sitemap con las rutas públicas en ambos locales. Cada entrada declara sus
 * alternates `hreflang` (es/en) para que Google indexe las dos versiones y
 * las relacione entre sí.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const publicPaths: Array<{ path: string; priority: number }> = [
    { path: "", priority: 1.0 },
    { path: "/login", priority: 0.5 },
    { path: "/signup", priority: 0.5 },
  ];

  return publicPaths.flatMap(({ path, priority }) => {
    const languages = Object.fromEntries(
      routing.locales.map((locale) => [locale, absoluteUrl(`/${locale}${path}`)]),
    );
    return routing.locales.map((locale) => ({
      url: absoluteUrl(`/${locale}${path}`),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority,
      alternates: { languages },
    }));
  });
}
