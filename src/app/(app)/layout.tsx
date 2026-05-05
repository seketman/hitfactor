import { redirect } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/db/profiles";

/**
 * Layout para todas las rutas autenticadas.
 * Redirige a /login si no hay sesión y monta el header común.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const profile = await getProfile(supabase, userData.user.id);
  const userName = profile?.display_name ?? userData.user.email ?? "—";

  return (
    <>
      <AppHeader userName={userName} />
      {children}
    </>
  );
}
