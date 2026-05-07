import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/db/profiles";

/**
 * Layout para todas las rutas autenticadas.
 * Redirige a /login si no hay sesión y monta el sidebar (collapsable en
 * desktop, drawer en mobile).
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
    <div className="md:flex">
      <AppSidebar userName={userName} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
