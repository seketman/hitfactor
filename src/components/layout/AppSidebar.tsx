import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { listMyDisciplines } from "@/lib/db/shooters";
import { APP_VERSION } from "@/lib/version";
import {
  SIDEBAR_COLLAPSED_COOKIE,
  parseSidebarCollapsed,
} from "@/lib/sidebar-preference";
import { AppSidebarShell } from "./AppSidebarShell";

interface AppSidebarProps {
  userId: string;
  userName: string;
  userEmail?: string | null;
  memberSince?: string | null;
}

/**
 * Server wrapper: fetcha las disciplinas en las que el usuario tiene al menos
 * una participación y se las pasa al shell client-side. El shell maneja
 * collapse + estado activo + drawer mobile.
 *
 * Recibe `userId` como prop desde el layout (que ya verificó autenticación)
 * para evitar un segundo `auth.getUser()` que puede correr en paralelo con
 * el layout y romper si hay un mismatch de cookie.
 *
 * Acá también se lee la preferencia de collapse, para que el shell reciba el
 * estado inicial ya resuelto y el server renderice el DOM correcto desde el
 * primer paint (#209). Este componente ya leía cookies para auth, así que no
 * agrega un acceso que antes no existiera.
 */
export async function AppSidebar({
  userId,
  userName,
  userEmail,
  memberSince,
}: AppSidebarProps) {
  const supabase = await createClient();
  const [disciplines, cookieStore] = await Promise.all([
    listMyDisciplines(supabase, userId),
    cookies(),
  ]);

  return (
    <AppSidebarShell
      userName={userName}
      userEmail={userEmail}
      memberSince={memberSince}
      disciplines={disciplines}
      appVersion={APP_VERSION}
      defaultCollapsed={parseSidebarCollapsed(
        cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value,
      )}
    />
  );
}
