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
    //  - route handlers que se manejan solos: auth/* (OAuth/Supabase), q/*
    //    (shortlink QR público) y api/* (health check) — no deben
    //    prefijarse con locale.
    //  - special files sin extensión (opengraph-image, apple-icon, icon)
    //  - cualquier archivo con extensión (.svg, .png, sitemap.xml, robots.txt,
    //    manifest.webmanifest, etc.)
    //
    // Una ruta que falte acá NO falla ruidosamente: se la redirige a
    // `/<locale>/<ruta>`, que no existe, y devuelve 404. `/api/health`
    // entró así —307 a `/es/api/health`— con toda la suite en verde,
    // porque un matcher no lo prueba nada más que ejercitándolo.
    // `tests/proxy-matcher.test.ts` lo cubre ahora.
    //
    // El `(?:/|$)` ancla cada exclusión a un segmento completo. Sin él la
    // lista excluía por PREFIJO: `q` se comía `/quiz`, `auth` se comía
    // `/authors` e `icon` se comía `/iconography`, dejándolos sin locale
    // en silencio. Hoy ninguna de esas rutas existe —por eso nunca se
    // notó— pero crearlas habría roto su i18n sin ningún síntoma que
    // apuntara acá. Agregar `api` ensanchaba la trampa a `/apiary`.
    "/((?!(?:_next|_vercel|auth|q|api|opengraph-image|apple-icon|icon)(?:/|$)|.*\\..*).*)",
  ],
};
