import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { getSiteUrl } from "@/lib/seo/site-url";
import { routing } from "@/i18n/routing";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // metadataBase hace que todas las URLs relativas de metadata (og:image,
  // canonical, etc.) se resuelvan a URLs absolutas automáticamente.
  metadataBase: new URL(getSiteUrl()),
  title: "HitFactor",
  description: "Tu historial de matches y stages de tiro deportivo.",
  // Verificación de propiedad en Google Search Console y Bing Webmaster Tools.
  verification: {
    google: "3gnfzDn0WL6Gj0br1QOHIKMvNc3FGRYsFYKbNiHREHU",
    other: { "msvalidate.01": "7215C47CF39FFCA40199B8DA385A5700" },
  },
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // Habilita el render estático del árbol para este locale (next-intl).
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      // suppressHydrationWarning: necesario porque next-themes setea
      // la clase del tema antes de la hidratación del cliente.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="bg-bg text-fg min-h-full flex flex-col">
        <NextIntlClientProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </NextIntlClientProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
