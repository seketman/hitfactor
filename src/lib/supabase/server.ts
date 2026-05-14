import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

/**
 * Cliente de Supabase para Server Components, Route Handlers y Server Actions.
 * Lee/escribe la sesión desde las cookies del request.
 *
 * Envuelto en `cache()` (React): dentro de un mismo request todas las llamadas
 * a `createClient()` devuelven la misma instancia. Esto importa porque en cada
 * render el layout y la page hacen `requireUser()` por separado — sin el cache
 * eso eran dos clientes distintos, y cualquier `cache()` sobre funciones de
 * data-access (ver `getProfile`, `listClubs`) no podía deduplicar porque el
 * argumento `supabase` no era estable. El scope de `cache()` es por request,
 * así que Route Handlers y Server Actions reciben cada uno su instancia fresca.
 */
export const createClient = cache(async () => {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll fallará en Server Components puros (sin Server Action ni Route Handler).
            // Es seguro ignorar el error porque el middleware refresca la sesión.
          }
        },
      },
    },
  );
});
