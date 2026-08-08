"use server";

import { getLocale, getTranslations } from "next-intl/server";
// Único `redirect` de la app que NO usa el wrapper de `@/i18n/navigation`:
// `data.url` es una URL absoluta del proveedor OAuth (Google), externa a la
// app. Prefijarle un locale la rompería.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { redirectWithError } from "@/lib/redirects";
import { absoluteUrl } from "@/lib/seo/site-url";

/**
 * Starts the Google OAuth flow. Supabase answers with the provider's URL
 * and we send the user there. On the way back they land on
 * `/auth/callback`, which exchanges the code for a session.
 *
 * ## Where `redirectTo` comes from (#219)
 *
 * It used to be assembled from the request's `Host` / `X-Forwarded-Proto`
 * headers, which are client input — on a surface that decides where the
 * OAuth `code` gets delivered. It now comes from `NEXT_PUBLIC_SITE_URL`
 * via `absoluteUrl`, the same source of truth the SEO metadata and the
 * printable QR (#198) use.
 *
 * This was never exploitable: Supabase validates `redirectTo` against the
 * allowlist in Authentication → URL Configuration, and that list is
 * pinned to the exact host — a tampered header matched nothing and fell
 * back to the Site URL. The allowlist was and remains the real control.
 * This just stops us handing it untrusted input to validate.
 *
 * ## Why this doesn't cost preview deploys
 *
 * The old comment claimed the header approach was needed so the flow
 * worked "en local, en preview de Vercel y en prod". Only two of those
 * were true. The allowlist has no wildcard for Vercel's per-deploy
 * preview hosts, so a sign-in from a preview already produced a
 * `redirectTo` that matched nothing and got sent to the Site URL —
 * production. Preview logins have always landed on production; this
 * reaches the same place without the header.
 *
 * Local dev works because `NEXT_PUBLIC_SITE_URL` is `http://localhost:3000`
 * there, which is also what `getSiteUrl` falls back to when it's unset.
 */
export async function signInWithGoogle() {
  const locale = await getLocale();
  const t = await getTranslations("actionError");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: absoluteUrl("/auth/callback"),
    },
  });

  if (error || !data?.url) {
    redirectWithError(
      "/login",
      error?.message ?? t("googleLoginFailed"),
      locale,
    );
  }

  redirect(data.url);
}
