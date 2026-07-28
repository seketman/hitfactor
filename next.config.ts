import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // OJO: esto NO sirve para subir archivos grandes. Vercel corta el
      // body de una Function en 4.5 MB a nivel plataforma (413
      // FUNCTION_PAYLOAD_TOO_LARGE) antes de invocar el código, así que
      // subir este número por encima de ese techo solo hace que dev
      // local acepte payloads que producción rechaza — que es
      // exactamente cómo se nos escapó el bug de los PDFs de 8 MB.
      //
      // Los archivos ya no viajan por acá: el browser los sube directo a
      // Supabase Storage y el server action recibe solo las referencias
      // (ver `@/lib/import/storage`). Lo más pesado que queda en el body
      // es el `ParsedMatch` que ida y vuelta en el flujo "falta la fecha"
      // de los rankings FAT, del orden de cientos de KB.
      //
      // 4 MB mantiene dev y prod alineados: si algo no entra acá,
      // tampoco iba a entrar en Vercel.
      bodySizeLimit: "4mb",
    },
  },
};

export default withNextIntl(nextConfig);
