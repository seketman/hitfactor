import { type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import createMiddleware from "next-intl/middleware";
import type { Database } from "@/lib/supabase/database.types";
import { routing } from "@/i18n/routing";

const handleI18nRouting = createMiddleware(routing);

/**
 * Proxy (Next 16 renombró `middleware` → `proxy`). Compone dos cosas:
 *
 *  1. **next-intl**: detecta el locale (cookie `NEXT_LOCALE` → `Accept-Language`),
 *     redirige las URLs sin prefijo al locale correspondiente y arma la
 *     respuesta base.
 *  2. **Supabase**: refresca la sesión en cada request escribiendo las cookies
 *     de auth renovadas sobre ESA respuesta (patrón canónico de composición:
 *     next-intl genera la respuesta, Supabase le pega sus `Set-Cookie`).
 *
 * El orden importa: i18n produce el response (posible redirect + cookie de
 * locale) y Supabase escribe sus cookies encima, así no se pierde ninguno.
 */
export async function proxy(request: NextRequest) {
  const response = handleI18nRouting(request);

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // No correr código entre createServerClient y getUser: los problemas de
  // auth son difíciles de debuggear.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Corre en todas las rutas EXCEPTO:
    //  - infra de Next/Vercel (_next, _vercel)
    //  - route handlers que se manejan solos: auth/* (OAuth/Supabase) y q/*
    //    (shortlink QR público) — no deben prefijarse con locale.
    //  - special files sin extensión (opengraph-image, apple-icon, icon)
    //  - cualquier archivo con extensión (.svg, .png, sitemap.xml, robots.txt,
    //    manifest.webmanifest, etc.)
    "/((?!_next|_vercel|auth|q|opengraph-image|apple-icon|icon|.*\\..*).*)",
  ],
};
