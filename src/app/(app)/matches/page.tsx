import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MatchList } from "@/components/MatchList";
import { requireUser } from "@/lib/supabase/require-user";
import { listAllMatches } from "@/lib/db/matches";
import { listClubs } from "@/lib/db/clubs";

/**
 * Listado de todos los matches del sistema. Antes vivía como sección dentro
 * del dashboard; lo movimos acá para dejar al dashboard enfocado en la info
 * del tirador (KPIs + historial).
 *
 * El botón "Importar match" reemplaza al item "Importar" del sidebar — ahora
 * es la acción principal de esta página.
 */
export default async function MatchesPage() {
  const { supabase, user } = await requireUser();

  // 200 cubre cómodo el rango de un usuario activo. Si el sistema crece y
  // hace falta paginar, este es el punto a mejorar.
  const [matches, clubs] = await Promise.all([
    listAllMatches(supabase, 200),
    listClubs(supabase),
  ]);

  return (
    <PageContainer>
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Matches</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {matches.length === 0
              ? "Todavía no se importó ningún match."
              : `${matches.length} torneo${matches.length === 1 ? "" : "s"} cargado${matches.length === 1 ? "" : "s"} en HitFactor`}
          </p>
        </div>
        <Link href="/import">
          <Button>Importar match</Button>
        </Link>
      </header>

      {matches.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-fg-muted">
            Sé el primero en importar uno desde tu planilla de PractiScore o el
            CSV de Tiro FBI.
          </p>
          <Link href="/import" className="mt-4 inline-block">
            <Button size="sm">Importar el primero</Button>
          </Link>
        </Card>
      ) : (
        <MatchList
          matches={matches}
          userId={user.id}
          from="/matches"
          clubs={clubs}
        />
      )}
    </PageContainer>
  );
}
