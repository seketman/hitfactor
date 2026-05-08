import { AppSidebar } from "@/components/layout/AppSidebar";
import { requireUser } from "@/lib/supabase/require-user";
import { getProfile } from "@/lib/db/profiles";
import { formatDate } from "@/lib/utils";

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
  // user.created_at viene como ISO timestamp completo (YYYY-MM-DDTHH:mm:ssZ).
  // formatDate trabaja sobre la parte YYYY-MM-DD: cortamos los primeros 10.
  const memberSince = user.created_at
    ? formatDate(user.created_at.slice(0, 10))
    : null;

  return (
    <div className="md:flex">
      <AppSidebar
        userId={user.id}
        userName={userName}
        userEmail={user.email}
        memberSince={memberSince}
      />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
