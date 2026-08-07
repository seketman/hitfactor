"use server";

import { getLocale, getTranslations } from "next-intl/server";
import { headers } from "next/headers";
// Único `redirect` de la app que NO usa el wrapper de `@/i18n/navigation`:
// `data.url` es una URL absoluta del proveedor OAuth (Google), externa a la
// app. Prefijarle un locale la rompería.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { redirectWithError } from "@/lib/redirects";

/**
 * Inicia el flujo OAuth con Google. Supabase responde con la URL del
 * provider; nosotros redirigimos al usuario ahí. Cuando vuelve, cae en
 * `/auth/callback` que ya canjea el code por una sesión.
 *
 * El `redirectTo` tiene que ser absoluto para que Google + Supabase lo
 * acepten — lo armamos desde los headers de la request, no hardcodeamos
 * el dominio para que funcione en local, en preview de Vercel y en prod.
 */
export async function signInWithGoogle() {
  const locale = await getLocale();
  const t = await getTranslations("actionError");
  const headersList = await headers();
  const host = headersList.get("host");
  // En Vercel y otros proxies viene el proto en x-forwarded-proto. En local
  // (dev server) puede no venir → asumimos http si el host es localhost,
  // https en cualquier otro caso.
  const proto =
    headersList.get("x-forwarded-proto") ??
    (host?.startsWith("localhost") ? "http" : "https");
  const baseUrl = `${proto}://${host}`;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${baseUrl}/auth/callback`,
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
