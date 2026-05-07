import { createClient } from "@/lib/supabase/server";
import { listMyDisciplines } from "@/lib/db/shooters";
import { AppSidebarShell } from "./AppSidebarShell";

/**
 * Server wrapper: fetcha las disciplinas en las que el usuario tiene al menos
 * una participación y se las pasa al shell client-side. El shell maneja
 * collapse + estado activo + drawer mobile.
 */
export async function AppSidebar({ userName }: { userName: string }) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user!.id;

  const disciplines = await listMyDisciplines(supabase, userId);

  return <AppSidebarShell userName={userName} disciplines={disciplines} />;
}
