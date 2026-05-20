import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "HitFactor — Tu historial de tiro deportivo",
  description:
    "Importá la planilla de resultados de tus torneos de tiro y seguí tu historial, tus estadísticas y tu progreso por disciplina. Gratis.",
};

/**
 * Home (`/`). Si hay sesión, va directo al dashboard; si no, muestra la
 * landing pública que presenta la app antes del registro/login.
 */
export default async function HomePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    redirect("/dashboard");
  }
  return <LandingPage />;
}
