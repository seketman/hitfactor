import type { Metadata } from "next";
import { redirect } from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { localeAlternates, resolveLocale } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { LandingPage } from "@/components/landing/LandingPage";
import { JsonLd } from "@/components/seo/JsonLd";
import { getSiteUrl } from "@/lib/seo/site-url";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: requested } = await params;
  const locale = resolveLocale(requested);
  const t = await getTranslations({ locale, namespace: "landingMeta" });
  const title = t("title");
  const description = t("description");
  return {
    title,
    description,
    keywords: t("keywords")
      .split(",")
      .map((k) => k.trim()),
    authors: [{ name: "Seketman" }],
    alternates: {
      canonical: `/${locale}`,
      languages: localeAlternates(),
    },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      url: `/${locale}`,
      siteName: "HitFactor",
      locale: t("ogLocale"),
      type: "website",
      // No `images`: the `[locale]/opengraph-image.tsx` convention emits
      // them, with its own size and its translated `alt`. Writing them here
      // overrode it, and the hand-written URL kept pointing at the root
      // `/opengraph-image` after the file moved — a 404 on every share.
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

/**
 * Home (`/`). Si hay sesión, va directo al dashboard; si no, muestra la
 * landing pública que presenta la app antes del registro/login.
 */
export default async function HomePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    const locale = await getLocale();
    redirect({ href: "/dashboard", locale });
  }
  const t = await getTranslations("landingMeta");
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "HitFactor",
          url: getSiteUrl(),
          description: t("description"),
          applicationCategory: "SportsApplication",
          inLanguage: t("inLanguage"),
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          creator: { "@type": "Person", name: "Seketman" },
        }}
      />
      <LandingPage />
    </>
  );
}
