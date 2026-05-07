import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { HistoryTable } from "@/components/HistoryTable";
import { StatsOverview } from "@/components/StatsOverview";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/db/profiles";
import { listMyShooters } from "@/lib/db/shooters";
import {
  getDivisionSizes,
  listAllMatches,
  listEntriesByShooters,
} from "@/lib/db/matches";
import { computeShooterStats } from "@/lib/stats/shooter-stats";
import { listFirearmUsageStats } from "@/lib/db/firearms";
import { parseRegion } from "@/lib/clubs";
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
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user!.id;
  const isConsolidated = disciplineCode === null;

  const [profile, myShooters, allMatches, firearmStats] = await Promise.all([
    getProfile(supabase, userId),
    listMyShooters(supabase, userId),
    listAllMatches(supabase),
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

  const filteredMatches = isConsolidated
    ? allMatches
    : allMatches.filter((m) => m.disciplines?.code === disciplineCode);

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
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{headerTitle}</h1>
          <p className="mt-1 text-sm text-fg-muted">{headerSubtitle}</p>
        </div>
        <Link href="/import">
          <Button>Importar match</Button>
        </Link>
      </header>

      {myEntries.length > 0 && (
        <>
          <Section title="Tu performance">
            <StatsOverview
              stats={computeShooterStats(myEntries, { divisionSizes })}
            />
          </Section>

          <Section title={`Tu historial (${myEntries.length})`}>
            <HistoryTable entries={myEntries} />
          </Section>
        </>
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

      <Section
        title={isConsolidated ? "Matches" : `Matches de ${disciplineName ?? "la disciplina"}`}
      >
        {filteredMatches.length === 0 ? (
          <Card className="p-10 text-center">
            <p className="text-fg-muted">
              {isConsolidated
                ? "Todavía no se importó ningún match."
                : "Todavía no se importó ningún match en esta disciplina."}
            </p>
            {isConsolidated && (
              <Link href="/import" className="mt-4 inline-block">
                <Button size="sm">Importar el primero</Button>
              </Link>
            )}
          </Card>
        ) : (
          <MatchList matches={filteredMatches} userId={userId} />
        )}
      </Section>
    </PageContainer>
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

function MatchList({
  matches,
  userId,
}: {
  matches: Array<{
    id: string;
    name: string;
    date: string;
    region: string | null;
    imported_by_user_id: string;
    disciplines: { code: string; name: string } | null;
  }>;
  userId: string;
}) {
  return (
    <Card>
      <ul className="divide-y divide-border">
        {matches.map((m) => {
          const isMine = m.imported_by_user_id === userId;
          const club = parseRegion(m.region);
          const clubLabel = club.clubName ?? club.clubCode ?? m.region;
          return (
            <li key={m.id}>
              <Link
                href={`/matches/${m.id}`}
                className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-surface-2/40"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    <span className="truncate">{m.name}</span>
                    {m.disciplines && (
                      <Badge tone="accent" title={m.disciplines.code}>
                        {m.disciplines.name}
                      </Badge>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {formatDate(m.date)}
                    {clubLabel && ` · ${clubLabel}`}
                  </p>
                </div>
                {isMine && <Badge>vos importaste</Badge>}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
