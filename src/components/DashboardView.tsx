import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { HistoryTable } from "@/components/HistoryTable";
import { StatsOverview } from "@/components/StatsOverview";
import { requireUser } from "@/lib/supabase/require-user";
import { getProfile } from "@/lib/db/profiles";
import { listMyShooters } from "@/lib/db/shooters";
import {
  getDivisionSizes,
  listEntriesByShooters,
} from "@/lib/db/matches";
import { computeShooterStats } from "@/lib/stats/shooter-stats";
import { listFirearmUsageStats } from "@/lib/db/firearms";
import { formatDate } from "@/lib/utils";
import type { DisciplineCode } from "@/lib/disciplines";

interface DashboardViewProps {
  /** Filtra entries y matches a esta disciplina. Null = vista consolidada. */
  disciplineCode: DisciplineCode | null;
  /** Nombre legible de la disciplina (cuando se filtra). */
  disciplineName?: string | null;
}

/**
 * Vista del dashboard. Server Component que se reutiliza desde dos rutas:
 *  - `/dashboard` (consolidado, disciplineCode=null): incluye TODAS las
 *    disciplinas + sección "Tus armas".
 *  - `/dashboard/[discipline]`: filtra a una disciplina; oculta la sección
 *    "Tus armas" para no saturar.
 */
export async function DashboardView({
  disciplineCode,
  disciplineName,
}: DashboardViewProps) {
  const { supabase, user } = await requireUser();
  const userId = user.id;
  const isConsolidated = disciplineCode === null;

  const [profile, myShooters, firearmStats] = await Promise.all([
    getProfile(supabase, userId),
    listMyShooters(supabase, userId),
    isConsolidated
      ? listFirearmUsageStats(supabase, userId)
      : Promise.resolve([]),
  ]);

  const allEntries = await listEntriesByShooters(
    supabase,
    myShooters.map((s) => s.id),
  );

  const myEntries = isConsolidated
    ? allEntries
    : allEntries.filter(
        (e) => e.matches?.disciplines?.code === disciplineCode,
      );

  const uniqueMatchIds = Array.from(
    new Set(myEntries.map((e) => e.matches?.id).filter((id): id is string => !!id)),
  );
  const divisionSizes = await getDivisionSizes(supabase, uniqueMatchIds);

  const headerTitle = isConsolidated
    ? `Hola, ${profile?.display_name ?? "tirador"}`
    : (disciplineName ?? "Disciplina");

  const headerSubtitle = isConsolidated
    ? renderConsolidatedSubtitle(myShooters)
    : `${myEntries.length} torneo${myEntries.length === 1 ? "" : "s"} disputado${myEntries.length === 1 ? "" : "s"} en esta disciplina`;

  return (
    <PageContainer>
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{headerTitle}</h1>
        <p className="mt-1 text-sm text-fg-muted">{headerSubtitle}</p>
      </header>

      {myEntries.length > 0 ? (
        <>
          <Section title="Tu performance">
            <StatsOverview
              stats={computeShooterStats(myEntries, { divisionSizes })}
            />
          </Section>

          <Section title={`Tu historial (${myEntries.length})`}>
            <HistoryTable
              entries={myEntries}
              showDisciplineFilter={isConsolidated}
            />
          </Section>
        </>
      ) : (
        <EmptyState hasIdentities={myShooters.length > 0} />
      )}

      {isConsolidated && firearmStats.length > 0 && (
        <Section title="Tus armas">
          <Card>
            <ul className="divide-y divide-border">
              {firearmStats.map(({ firearm, totalRounds, totalMatches, lastUsedDate }) => (
                <li key={firearm.id}>
                  <Link
                    href={`/firearms/${firearm.id}`}
                    className="flex flex-wrap items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2/40"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{firearm.name}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted">
                        {firearm.brand && <span>{firearm.brand}</span>}
                        {firearm.model && <span>{firearm.model}</span>}
                        {firearm.caliber && <Badge>{firearm.caliber}</Badge>}
                      </p>
                    </div>
                    <div className="text-right text-sm">
                      <p className="font-mono text-fg">
                        {totalRounds.toLocaleString("es-AR")} tiros
                      </p>
                      <p className="text-xs text-fg-subtle">
                        {totalMatches} torneo{totalMatches === 1 ? "" : "s"}
                        {lastUsedDate && ` · últ. ${formatDate(lastUsedDate)}`}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}
    </PageContainer>
  );
}

/**
 * Estado del dashboard cuando el usuario no tiene aún match_entries:
 *  - Sin identidades: necesita encontrarse en algún match y hacer "Soy yo"
 *  - Con identidades pero sin entries: probablemente no se importaron sus matches
 */
function EmptyState({ hasIdentities }: { hasIdentities: boolean }) {
  return (
    <Card className="p-10 text-center">
      {hasIdentities ? (
        <>
          <p className="font-medium">Tus stats van a aparecer acá</p>
          <p className="mt-2 text-sm text-fg-muted">
            En cuanto se importe un match en el que hayas participado, vas a
            ver tu performance, KPIs e historial.
          </p>
          <Link href="/matches" className="mt-4 inline-block">
            <Button size="sm">Ver matches</Button>
          </Link>
        </>
      ) : (
        <>
          <p className="font-medium">Linkeá tu identidad de tirador</p>
          <p className="mt-2 text-sm text-fg-muted">
            Buscá tu nombre en el ranking de algún match y dale a "Soy yo"
            para empezar a ver tus estadísticas acá.
          </p>
          <Link href="/matches" className="mt-4 inline-block">
            <Button size="sm">Ver matches</Button>
          </Link>
        </>
      )}
    </Card>
  );
}

function renderConsolidatedSubtitle(
  myShooters: Awaited<ReturnType<typeof listMyShooters>>,
) {
  if (myShooters.length === 0) {
    return "Aún no linkeaste tu identidad. Buscá tu nombre en algún match para hacerlo.";
  }
  if (myShooters.length === 1) {
    return (
      <>
        Linkeado como <span className="text-fg">{myShooters[0]!.full_name}</span>
      </>
    );
  }
  return (
    <>
      Linkeado como{" "}
      <span
        className="text-fg"
        title={myShooters.map((s) => s.full_name).join(" · ")}
      >
        {myShooters[0]!.full_name}
      </span>{" "}
      <span className="text-fg-subtle">
        (+{myShooters.length - 1}{" "}
        {myShooters.length - 1 === 1 ? "identidad" : "identidades"})
      </span>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-fg-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

