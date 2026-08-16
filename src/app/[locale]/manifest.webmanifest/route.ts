import type { MetadataRoute } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale, routing } from "@/i18n/routing";

/**
 * Web app manifest, one per locale.
 *
 * This is a Route Handler rather than Next's `manifest.ts` file convention
 * because that convention only exists at the **root** of `app/` — there is
 * no way to colocate it in a segment, so a locale-aware manifest cannot use
 * it. `opengraph-image` next door *is* segment-scoped and does.
 *
 * The locale layout points at this URL through `metadata.manifest`, which is
 * what emits the `<link rel="manifest">` tag.
 *
 * Two things are locale-dependent here and both matter at install time: the
 * `description` the browser shows in the install prompt, and `start_url` —
 * installing from the Spanish site should open the app in Spanish, not send
 * the user through locale detection again.
 *
 * `name`/`short_name` stay literal: the product is called HitFactor in every
 * language, which is why they are not in `messages/`.
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string }> },
) {
  const locale = resolveLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "meta" });

  const manifest: MetadataRoute.Manifest = {
    name: "HitFactor",
    short_name: "HitFactor",
    description: t("manifestDescription"),
    start_url: `/${locale}`,
    display: "standalone",
    background_color: "#fafaf9",
    theme_color: "#d97706",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/apple-icon", type: "image/png", sizes: "180x180" },
    ],
  };

  return Response.json(manifest, {
    headers: { "content-type": "application/manifest+json" },
  });
}
