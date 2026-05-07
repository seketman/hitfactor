import { redirect } from "next/navigation";
import { createClient } from "./server";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Server-side: garantiza que hay un usuario autenticado y devuelve el cliente
 * Supabase + el user. Si no hay sesión, redirige a /login.
 *
 * Lo usamos en cada Server Component que necesita `user.id`. Antes había
 * pages que hacían `userData.user!.id` con non-null assertion: cuando el
 * layout y la page se renderizan en paralelo y el cookie de sesión no está
 * (o expiró), el `!` revienta con TypeError aunque el redirect del layout
 * igual sirva el 307 al cliente. Este helper hace explícito el fallback.
 */
export async function requireUser(): Promise<{
  supabase: SupabaseClient;
  user: User;
}> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  return { supabase, user: data.user };
}
