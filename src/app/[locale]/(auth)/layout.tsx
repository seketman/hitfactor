import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Layout para login/signup. Redirige al dashboard si ya estás logueado.
 */
export default async function AuthLayoutWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  // `getLocale()` inline por lo mismo que en `require-user`: el redirect es el
  // caso excepcional (usuario ya logueado entrando a /login), no el común.
  if (data.user) redirect({ href: "/dashboard", locale: await getLocale() });

  return <>{children}</>;
}
