import { redirect } from "next/navigation";
import { createClient } from "./server";
import { isInternalAppPath } from "@/lib/redirects";
import type { User } from "@supabase/supabase-js";
import type { TypedSupabaseClient } from "./types";

interface RequireUserOptions {
  /**
   * Path interno al que volver después del login. Solo se preserva si es
   * una ruta válida según `isInternalAppPath` — protección contra open
   * redirects (un usuario nunca debería poder forzar el regreso a una URL
   * externa via el cookie de origen). Si pasás algo con query o hash,
   * isInternalAppPath lo rechaza y caemos al default (/dashboard).
   *
   * Use case típico: páginas a las que se llega vía un QR pegado físicamente
   * (#58). Sin esto, el QR pierde el destino al pasar por /login y el
   * tirador termina en /dashboard preguntándose adónde ir.
   */
  returnTo?: string;
}

/**
 * Server-side: garantiza que hay un usuario autenticado y devuelve el cliente
 * Supabase + el user. Si no hay sesión, redirige a /login (opcionalmente con
 * `?next=<returnTo>` para que el login lo lleve de vuelta).
 *
 * Lo usamos en cada Server Component que necesita `user.id`. Antes había
 * pages que hacían `userData.user!.id` con non-null assertion: cuando el
 * layout y la page se renderizan en paralelo y el cookie de sesión no está
 * (o expiró), el `!` revienta con TypeError aunque el redirect del layout
 * igual sirva el 307 al cliente. Este helper hace explícito el fallback.
 */
export async function requireUser(
  opts: RequireUserOptions = {},
): Promise<{
  supabase: TypedSupabaseClient;
  user: User;
}> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    const next = isInternalAppPath(opts.returnTo)
      ? `?next=${encodeURIComponent(opts.returnTo)}`
      : "";
    redirect(`/login${next}`);
  }
  return { supabase, user: data.user };
}
