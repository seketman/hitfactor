import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LandingPage } from "@/components/landing/LandingPage";
import { JsonLd } from "@/components/seo/JsonLd";
import { getSiteUrl } from "@/lib/seo/site-url";

const TITLE = "HitFactor — Tu historial de tiro deportivo";
const DESCRIPTION =
  "Importá la planilla de resultados de tus torneos de tiro y seguí tu historial, tus estadísticas y tu progreso por disciplina. Gratis.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "tiro deportivo",
    "IPSC",
    "Tiro FBI",
    "Steel Challenge",
    "historial torneos",
    "Argentina",
  ],
  authors: [{ name: "Seketman" }],
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    siteName: "HitFactor",
    locale: "es_AR",
    type: "website",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "HitFactor" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/opengraph-image"],
  },
};

/**
 * Home (`/`). Si hay sesión, va directo al dashboard; si no, muestra la
 * landing pública que presenta la app antes del registro/login.
 */
export default async function HomePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    redirect("/dashboard");
  }
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "HitFactor",
          url: getSiteUrl(),
          description: DESCRIPTION,
          applicationCategory: "SportsApplication",
          inLanguage: "es-AR",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          creator: { "@type": "Person", name: "Seketman" },
        }}
      />
      <LandingPage />
    </>
  );
}
