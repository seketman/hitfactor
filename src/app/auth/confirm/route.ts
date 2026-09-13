import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeBackPath } from "@/lib/paths";
import { resolveLocale } from "@/i18n/routing";

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

  // The language to land in, carried by the email template from the
  // `locale` this account recorded at signup (#151). This route sits outside
  // `[locale]`, so without it every confirmation landed in Spanish whatever
  // the user had been reading.
  //
  // Two separately validated pieces rather than one. `next=/en/dashboard`
  // would read better, but `isInternalAppPath` is a closed list of exact path
  // shapes and none of them carry a locale — by convention, which its own
  // comment states, though it gives an architectural reason rather than this
  // one. Either way the effect is the same: accepting a prefix here means
  // loosening a whitelist whose entire value is that it is closed, and that
  // closedness is what stands between an emailed link and an open redirect
  // (#218).
  //
  // So `next` stays a bare app path, and the locale arrives beside it as a
  // closed set of three values that `resolveLocale` narrows, falling back to
  // the default for an account that predates this or signed up through
  // Google.
  const locale = resolveLocale(searchParams.get("locale") ?? undefined);

  if (token_hash && typeParam && ALLOWED_TYPES.has(typeParam)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type: typeParam,
      token_hash,
    });
    if (!error) {
      return NextResponse.redirect(new URL(`/${locale}${next}`, origin));
    }
  }

  // Still an error code rather than prose: this route has a locale to send
  // the user to, but no catalogue to translate with. The login page does the
  // wording, and now it does it in the right language.
  return NextResponse.redirect(
    new URL(`/${locale}/login?authError=confirmFailed`, origin),
  );
}
