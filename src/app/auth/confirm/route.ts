import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeBackPath } from "@/lib/paths";

/**
 * Endpoint para los flujos de OTP por mail: signup confirm, magic link,
 * recovery y email_change.
 *
 * El link "Confirm Your Signup" que manda Supabase por defecto apunta a
 * `<proyecto>.supabase.co/auth/v1/verify`, que confirma el email server-side
 * pero NO setea cookies en el dominio de tu app — si el browser ya tenía una
 * sesión activa (otro usuario), esa sesión sobrevive y aterrizás logueado
 * como el viejo. Para fixearlo, configurás las plantillas de email para que
 * apunten acá con `?token_hash=...&type=signup`. Este handler llama
 * `verifyOtp`, que sí establece cookies para el user que está confirmando,
 * pisando la sesión previa.
 *
 * Setup requerido en Supabase Dashboard → Authentication → Email Templates:
 *   Confirm signup:   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup`
 *   Magic Link:       `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink`
 *   Reset Password:   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
 *   Change Email:     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change`
 *
 * No mezclamos esto con `/auth/callback`: ese sigue para el flujo PKCE de
 * OAuth (Google), que usa `?code=` y `exchangeCodeForSession`. Son protocolos
 * distintos — separarlos hace cada handler más simple y obvio.
 */

// Whitelist: el `type` viene del query string, no confiamos en strings
// arbitrarios. Si llega algo que no está acá, mandamos a la pantalla de error.
const ALLOWED_TYPES = new Set<EmailOtpType>([
  "signup",
  "magiclink",
  "recovery",
  "email_change",
  "invite",
]);

/**
 * `next` goes through the same whitelist the rest of the app uses, for the
 * same reason as in `/auth/callback` — see the note there. It matters more
 * on this route: these links arrive by email (signup confirmation, magic
 * link, password recovery), which is a far more comfortable delivery
 * channel for an attacker than anything OAuth offers.
 *
 * The `type` parameter was already whitelisted above. `next` was the one
 * that wasn't. See #218.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const typeParam = searchParams.get("type") as EmailOtpType | null;
  const next = safeBackPath(searchParams.get("next"), "/dashboard");

  if (token_hash && typeParam && ALLOWED_TYPES.has(typeParam)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type: typeParam,
      token_hash,
    });
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  // Error code rather than prose — this route is outside `[locale]`, so it
  // has no locale to translate with. The login page does it.
  return NextResponse.redirect(
    new URL("/login?authError=confirmFailed", origin),
  );
}
