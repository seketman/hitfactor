import { notFound } from "next/navigation";
import { DashboardView } from "@/components/DashboardView";
import { createClient } from "@/lib/supabase/server";
import type { DisciplineCode } from "@/lib/disciplines";

interface PageProps {
  params: Promise<{ discipline: string }>;
  searchParams: Promise<{ division?: string }>;
}

/**
 * Vista del dashboard filtrada a una disciplina específica.
 * El segmento de URL es el `code` de la disciplina (ej "ipsc", "tiro_fbi").
 * Acepta `?division=<code>` para acotar además a una división.
 *
 * Validamos disciplina y división contra la DB — si la disciplina no
 * existe, 404. Si la división no existe (o no pertenece a la disciplina),
 * la ignoramos silenciosamente (URL pegada/editada) en vez de 404'ear:
 * el dashboard sin division es una vista válida.
 */
export default async function DisciplineDashboardPage({
  params,
  searchParams,
}: PageProps) {
  const { discipline } = await params;
  const { division } = await searchParams;

  const supabase = await createClient();
  const { data: disciplineRow } = await supabase
    .from("disciplines")
    .select("id, code, name")
    .eq("code", discipline)
    .maybeSingle();

  if (!disciplineRow) notFound();

  // Resolución de división (opcional). Filtramos por `discipline_id` porque
  // los codes se solapan entre disciplinas — ej. `PIS` existe en IPSC y en
  // FBI.
  let divisionCode: string | null = null;
  let divisionName: string | null = null;
  if (division) {
    const { data: divRow } = await supabase
      .from("divisions")
      .select("code, name")
      .eq("code", division)
      .eq("discipline_id", disciplineRow.id as number)
      .maybeSingle();
    if (divRow) {
      divisionCode = divRow.code as string;
      divisionName = divRow.name as string;
    }
  }

  return (
    <DashboardView
      disciplineCode={disciplineRow.code as DisciplineCode}
      disciplineName={disciplineRow.name as string}
      divisionCode={divisionCode}
      divisionName={divisionName}
    />
  );
}
