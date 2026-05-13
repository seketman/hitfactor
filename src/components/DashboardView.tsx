import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { HistoryTable } from "@/components/HistoryTable";
import { StatsOverview } from "@/components/StatsOverview";
import { requireUser } from "@/lib/supabase/require-user";
import { getProfile } from "@/lib/db/profiles";
import { listMyShooters } from "@/lib/db/shooters";
import { listClubs } from "@/lib/db/clubs";
import {
  getDivisionSizes,
  listEntriesByShooters,
  listMyStageResultsForEntries,
} from "@/lib/db/matches";
import { computeShooterStats } from "@/lib/stats/shooter-stats";
import { DISCIPLINE, type DisciplineCode } from "@/lib/disciplines";

interface DashboardViewProps {
  /** Filtra entries y matches a esta disciplina. Null = vista consolidada. */
  disciplineCode: DisciplineCode | null;
  /** Nombre legible de la disciplina (cuando se filtra). */
  disciplineName?: string | null;
}

/**
 * Vista del dashboard. Server Component que se reutiliza desde dos rutas:
 *  - `/dashboard` (consolidado, disciplineCode=null): muestra todas las
 *    disciplinas agregadas
 *  - `/dashboard/[discipline]`: filtra a una disciplina específica
 *
 * Foco: información del tirador (KPIs + historial). El listado de matches
 * vive en `/matches` y el catálogo de armas en `/firearms`.
 */
export async function DashboardView({
  disciplineCode,
  disciplineName,
}: DashboardViewProps) {
  const { supabase, user } = await requireUser();
  const userId = user.id;
  const isConsolidated = disciplineCode === null;

  const [profile, myShooters, clubs] = await Promise.all([
    getProfile(supabase, userId),
    listMyShooters(supabase, userId),
    listClubs(supabase),
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
  const [divisionSizes, myStageResults] = await Promise.all([
    getDivisionSizes(supabase, uniqueMatchIds),
    listMyStageResultsForEntries(
      supabase,
      myEntries.map((e) => e.id),
    ),
  ]);

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
              stats={computeShooterStats(myEntries, {
                divisionSizes,
                stageResults: myStageResults,
              })}
              primaryMetric={
                disciplineCode === DISCIPLINE.FBI ? "hits" : "percentage"
              }
            />
          </Section>

          <Section title={`Tu historial (${myEntries.length})`}>
            <HistoryTable
              entries={myEntries}
              clubs={clubs}
              showDisciplineFilter={isConsolidated}
            />
          </Section>
        </>
      ) : (
        <EmptyState hasIdentities={myShooters.length > 0} />
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

