import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Default es 1 MB y los PDFs de stages WinMSS/ESS pueden pesar más
      // (un PDF con 72 páginas y muchas divisiones supera 1 MB sin
      // esfuerzo). 10 MB cubre cómodamente cualquier reporte realista
      // sin abrir la puerta a abuso.
      bodySizeLimit: "10mb",
    },
  },
};

export default withNextIntl(nextConfig);
