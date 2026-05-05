import Link from "next/link";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { createClient } from "@/lib/supabase/server";
import { getMyShooter } from "@/lib/db/shooters";
import { getMyMatchSummary } from "@/lib/db/matches";
import { getClubCode, getClubName } from "@/lib/clubs";
import { formatDate, formatNumber, formatPercent } from "@/lib/utils";

const POWER_FACTOR_LABELS: Record<string, string> = {
  Maj: "Major",
  Min: "Minor",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PersonalMatchPage({ params }: PageProps) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user!.id; // protegido por (app)/layout

  const myShooter = await getMyShooter(supabase, userId);

  if (!myShooter) {
    return (
      <PageContainer>
        <BackToDashboard />
        <Alert tone="warning" title="Necesitás linkear tu identidad de tirador">
          Para ver tu detalle del match, primero buscá tu nombre en el ranking
          público y dale a “Soy yo”.{" "}
          <Link href={`/matches/${id}`} className="underline hover:text-fg">
            Ir al ranking del match
          </Link>
        </Alert>
      </PageContainer>
    );
  }

  const summary = await getMyMatchSummary(supabase, id, myShooter.id);

  if (!summary) {
    notFound();
  }

  const { match, entry, stageResults } = summary;
  const clubCode = getClubCode(match.region);
  const clubName = getClubName(match.region);

  return (
    <PageContainer>
      <BackToDashboard />

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{match.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
            <span className="font-mono">{formatDate(match.date)}</span>
            {clubCode && (
              <span title={clubName ?? undefined}>
                {clubName ?? clubCode}
                {clubName ? ` · ${clubCode}` : ""}
              </span>
            )}
            {match.disciplines?.name && <span>{match.disciplines.name}</span>}
          </p>
        </div>
        <Link
          href={`/matches/${id}`}
          className="text-sm text-fg-muted hover:text-accent"
        >
          Ver ranking público →
        </Link>
      </header>

      <Card className="mb-8">
        <div className="grid grid-cols-2 gap-6 p-5 sm:grid-cols-5">
          <Stat label="División">
            {entry.divisions ? (
              <span title={entry.divisions.name}>
                {entry.divisions.code}
                <span className="ml-2 text-xs font-normal text-fg-muted">
                  {entry.divisions.name}
                </span>
              </span>
            ) : (
              "—"
            )}
          </Stat>
          <Stat label="Factor">
            {entry.power_factor ? POWER_FACTOR_LABELS[entry.power_factor] : "—"}
          </Stat>
          <Stat label="Categoría">{entry.category ?? "General"}</Stat>
          <Stat label="Puesto">
            {entry.is_dq ? <Badge tone="danger">DQ</Badge> : entry.place}
          </Stat>
          <Stat label="Match %" mono>
            {entry.is_dq ? "—" : formatPercent(entry.match_percentage)}
          </Stat>
        </div>
      </Card>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-fg-muted">
          Tu performance por stage
        </h2>

        {stageResults.length === 0 ? (
          <Card className="p-10 text-center">
            <p className="text-fg-muted">
              Los stages todavía no fueron importados para este match.
            </p>
            <p className="mt-2 text-xs text-fg-subtle">
              Subí los archivos <code>Stage Results</code> desde la página de
              import para verlos acá.
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>Stage</TH>
                  <TH className="text-right">Puesto</TH>
                  <TH className="text-right">Tiempo</TH>
                  <TH className="text-right">Points</TH>
                  <TH className="text-right">Pen.</TH>
                  <TH className="text-right">Hit Factor</TH>
                  <TH className="text-right">Stage Pts</TH>
                  <TH className="text-right">Stage %</TH>
                </TR>
              </THead>
              <TBody>
                {stageResults.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <span className="font-medium">
                        {r.stages?.stage_number != null
                          ? `Stage ${r.stages.stage_number}`
                          : r.stages?.name ?? "—"}
                      </span>
                    </TD>
                    <TD className="text-right font-mono">
                      {r.is_dq ? <Badge tone="danger">DQ</Badge> : r.place ?? "—"}
                    </TD>
                    <TD className="text-right font-mono text-fg-muted">
                      {r.time_seconds != null
                        ? `${formatNumber(r.time_seconds, 2)}s`
                        : "—"}
                    </TD>
                    <TD className="text-right font-mono text-fg-muted">
                      {formatNumber(r.points, 0)}
                    </TD>
                    <TD className="text-right font-mono text-fg-muted">
                      {r.penalties && Number(r.penalties) > 0 ? (
                        <span className="text-danger">
                          {formatNumber(r.penalties, 0)}
                        </span>
                      ) : (
                        formatNumber(r.penalties, 0)
                      )}
                    </TD>
                    <TD className="text-right font-mono">
                      {formatNumber(r.hit_factor, 4)}
                    </TD>
                    <TD className="text-right font-mono">
                      {formatNumber(r.stage_points, 2)}
                    </TD>
                    <TD className="text-right font-mono">
                      {r.is_dq ? "—" : formatPercent(r.stage_percentage)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        )}
      </section>
    </PageContainer>
  );
}

function BackToDashboard() {
  return (
    <Link
      href="/dashboard"
      className="mb-4 inline-block text-sm text-fg-muted hover:text-accent"
    >
      ← Volver al dashboard
    </Link>
  );
}

function Stat({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-fg-subtle">{label}</p>
      <p
        className={`mt-1 text-base font-medium${mono ? " font-mono" : ""}`}
      >
        {children}
      </p>
    </div>
  );
}
