import { notFound } from "next/navigation";
import { DashboardView } from "@/components/DashboardView";
import { createClient } from "@/lib/supabase/server";
import type { DisciplineCode } from "@/lib/disciplines";

interface PageProps {
  params: Promise<{ discipline: string }>;
}

/**
 * Vista del dashboard filtrada a una disciplina específica.
 * El segmento de URL es el `code` de la disciplina (ej "ipsc", "tiro_fbi").
 *
 * Validamos contra la tabla `disciplines` — si el code no existe, 404.
 */
export default async function DisciplineDashboardPage({ params }: PageProps) {
  const { discipline } = await params;

  const supabase = await createClient();
  const { data } = await supabase
    .from("disciplines")
    .select("code, name")
    .eq("code", discipline)
    .maybeSingle();

  if (!data) notFound();

  return (
    <DashboardView
      disciplineCode={data.code as DisciplineCode}
      disciplineName={data.name as string}
    />
  );
}
