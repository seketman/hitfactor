import { AppSidebar } from "@/components/layout/AppSidebar";
import { requireUser } from "@/lib/supabase/require-user";
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
  const { supabase, user } = await requireUser();
  const profile = await getProfile(supabase, user.id);
  const userName = profile?.display_name ?? user.email ?? "—";

  return (
    <div className="md:flex">
      <AppSidebar userId={user.id} userName={userName} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
