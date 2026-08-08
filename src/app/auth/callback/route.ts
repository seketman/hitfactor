import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeBackPath } from "@/lib/paths";

/**
 * Where users land after confirming their email or signing in via OAuth
 * (Google). Supabase puts a `code` in the query string, which we exchange
 * for a session.
 *
 * ## `next` is validated, not trusted (#218)
 *
 * It used to be concatenated onto the origin as-is:
 *
 *     NextResponse.redirect(`${origin}${next}`)
 *
 * `@` terminates the userinfo section of a URL, so `next=@evil.com`
 * produced `https://our-host@evil.com/` — host `evil.com`. An open
 * redirect firing **after** the session is established, reached through a
 * link that genuinely is on our domain.
 *
 * `safeBackPath` is the whitelist the rest of the app already uses for
 * exactly this (`login`, `claimShooter`, `requireUser`). Nothing in this
 * codebase ever sets `next` on this route — `signInWithGoogle` sends a
 * bare `redirectTo` — so in practice the parameter only ever arrives from
 * outside, and tightening it costs no real flow.
 *
 * `new URL(next, origin)` is the second layer: even if something got past
 * the whitelist, resolving a relative reference against the origin cannot
 * change the host.
 *
 * ## Why the redirect stays on the request origin
 *
 * Unlike the printable QR (#198), this one must NOT use the configured
 * site URL: the session cookie was just written for the host that served
 * this request. Sending the user to a different host would land them
 * logged out. Staying on `origin` is the correct behaviour here, and it's
 * what keeps preview deploys working.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeBackPath(searchParams.get("next"), "/dashboard");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  // An error code, not prose: this handler lives outside the `[locale]`
  // segment, so `getTranslations` here would always resolve to the default
  // locale and hand a Spanish sentence to an English user. The login page
  // has the locale and does the translating. Same rule the parsers follow
  // with `ParserError` (#148).
  return NextResponse.redirect(
    new URL("/login?authError=exchangeFailed", origin),
  );
}
