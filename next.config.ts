import type { NextConfig } from "next";

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

export default nextConfig;
