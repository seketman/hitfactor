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
  listImportedByUser,
} from "@/lib/db/matches";
import { computeShooterStats } from "@/lib/stats/shooter-stats";
import { formatDate } from "@/lib/utils";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user!.id; // garantizado por (app)/layout

  const [profile, myShooters, importedMatches, allMatches] = await Promise.all([
    getProfile(supabase, userId),
    listMyShooters(supabase, userId),
    listImportedByUser(supabase, userId),
    listAllMatches(supabase),
  ]);

  const myEntries = await listEntriesByShooters(
    supabase,
    myShooters.map((s) => s.id),
  );

  // Tamaños de división para calcular percentil — uno solo por match.
  const uniqueMatchIds = Array.from(
    new Set(myEntries.map((e) => e.matches?.id).filter((id): id is string => !!id)),
  );
  const divisionSizes = await getDivisionSizes(supabase, uniqueMatchIds);

  return (
    <PageContainer>
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Hola, {profile?.display_name ?? "tirador"}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            {myShooters.length === 0 ? (
              "Aún no linkeaste tu identidad. Buscá tu nombre en algún match para hacerlo."
            ) : myShooters.length === 1 ? (
              <>
                Linkeado como{" "}
                <span className="text-fg">{myShooters[0]!.full_name}</span>
              </>
            ) : (
              <>
                Linkeado como{" "}
                <span className="text-fg" title={myShooters.map((s) => s.full_name).join(" · ")}>
                  {myShooters[0]!.full_name}
                </span>{" "}
                <span className="text-fg-subtle">
                  (+{myShooters.length - 1} {myShooters.length - 1 === 1 ? "identidad" : "identidades"})
                </span>
              </>
            )}
          </p>
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

      <Section title="Matches que importaste">
        {importedMatches.length > 0 ? (
          <MatchList matches={importedMatches} showImporter={false} />
        ) : (
          <Card className="p-10 text-center">
            <p className="text-fg-muted">Todavía no importaste ningún match.</p>
            <Link href="/import" className="mt-4 inline-block">
              <Button size="sm">Importar el primero</Button>
            </Link>
          </Card>
        )}
      </Section>

      {allMatches.length > importedMatches.length && (
        <Section title="Todos los matches">
          <MatchList matches={allMatches} showImporter />
        </Section>
      )}
    </PageContainer>
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
  showImporter,
}: {
  matches: {
    id: string;
    name: string;
    date: string;
    region: string | null;
    disciplines: { code: string; name: string } | null;
  }[];
  showImporter: boolean;
}) {
  return (
    <Card>
      <ul className="divide-y divide-border">
        {matches.map((m) => (
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
                  {m.region && ` · ${m.region}`}
                </p>
              </div>
              {!showImporter && <Badge>vos importaste</Badge>}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
