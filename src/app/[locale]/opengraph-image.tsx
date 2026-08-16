import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveLocale, routing } from "@/i18n/routing";

// La generación lee el archivo de fuente del filesystem → runtime Node.
export const runtime = "nodejs";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * The alt text, per locale.
 *
 * `export const alt` is a static value and this file now sits under
 * `[locale]`, so it cannot be one — hence `generateImageMetadata`, whose
 * returned items carry their own `alt`. A single item: this route has one
 * image, the function is here for the metadata, not the multiplicity.
 *
 * Note the asymmetry the Next docs call out — `params` arrives plain here
 * and as a promise on the default export below.
 */
export async function generateImageMetadata({
  params,
}: {
  params: { locale: string };
}) {
  const locale = resolveLocale(params.locale);
  const t = await getTranslations({ locale, namespace: "meta" });
  return [{ id: "og", alt: t("ogAlt"), size, contentType }];
}

// Paleta de la marca (constitución): ámbar de acento + fondo oscuro del logo.
const AMBER = "#d97706";
const BG = "#0c0c10";
const SURFACE = "#18181b";
const FG = "#fafaf9";
const MUTED = "#a1a1aa";

/**
 * Open Graph image 1200×630 generada server-side. Reproduce la identidad de
 * HitFactor: la diana ámbar del logo + el wordmark + el tagline, sobre el
 * fondo oscuro de la marca. Sin dependencias externas (FR-015).
 */
export default async function Image({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "meta" });
  const geistBold = await readFile(
    join(
      process.cwd(),
      "node_modules/geist/dist/fonts/geist-sans/Geist-Bold.ttf",
    ),
  );

  // Diana: tres círculos concéntricos ámbar (mismo motivo que icon.svg).
  const Diana = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 220,
        height: 220,
        borderRadius: 9999,
        border: `10px solid ${AMBER}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 130,
          height: 130,
          borderRadius: 9999,
          border: `10px solid ${AMBER}`,
        }}
      >
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: 9999,
            background: AMBER,
          }}
        />
      </div>
    </div>
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 48,
          backgroundColor: BG,
          backgroundImage: `linear-gradient(135deg, ${BG} 0%, ${SURFACE} 100%)`,
          fontFamily: "Geist",
        }}
      >
        {Diana}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div style={{ fontSize: 96, fontWeight: 700, color: FG, letterSpacing: -2 }}>
            HitFactor
          </div>
          <div style={{ fontSize: 40, fontWeight: 700, color: MUTED }}>
            {t("ogTagline")}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Geist", data: geistBold, style: "normal", weight: 700 }],
    },
  );
}
