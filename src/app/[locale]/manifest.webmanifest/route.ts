import type { MetadataRoute } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";

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
 *
 * The locale is validated here rather than leaned on from elsewhere. The
 * `notFound()` guard in `[locale]/layout.tsx` does not cover this file —
 * Route Handlers are not wrapped by the segment layout — and next-intl's
 * proxy does not either, because the matcher in `src/proxy.ts` drops any
 * path containing a dot, which is every URL this route answers. Without
 * the check, `resolveLocale` quietly falls back and
 * `/anything/manifest.webmanifest` returns 200 with the Spanish manifest.
 * The sibling `opengraph-image` route has no dot in its URL, so the proxy
 * does reach it and redirects an unknown locale before it gets there.
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    return new Response(null, { status: 404 });
  }

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
    headers: {
      "content-type": "application/manifest+json",
      // Next's own `manifest.ts` codegen sends this. Hand-rolling the route
      // means hand-rolling the header, or the manifest silently inherits
      // whatever the CDN defaults to.
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}
