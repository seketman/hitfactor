import { redirect } from "next/navigation";
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
  if (data.user) redirect("/dashboard");

  return <>{children}</>;
}
