import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Endpoint al que vuelven los usuarios después de confirmar su email
 * o de loguearse via OAuth (Google).
 *
 * Supabase incluye un `code` en el query string que canjeamos por una sesión.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=No%20se%20pudo%20completar%20la%20autenticaci%C3%B3n`);
}
