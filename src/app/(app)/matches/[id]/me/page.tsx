import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { FirearmSelector } from "@/components/FirearmSelector";
import { requireUser } from "@/lib/supabase/require-user";
import { listMyShooters } from "@/lib/db/shooters";
import { listClubs } from "@/lib/db/clubs";
import {
  getMatchById,
  listMyEntriesInMatch,
  listStageResultsForEntry,
} from "@/lib/db/matches";
import {
  getMatchFirearmLog,
  listMyFirearms,
} from "@/lib/db/firearms";
import { estimateRoundsFired } from "@/lib/firearms/estimate-rounds";
import { isHitsBasedDiscipline, isTimeBasedDiscipline } from "@/lib/disciplines";
import type { MyMatchSummary } from "@/lib/db/types";
import { buildClubLookup, getClubCode, getClubName } from "@/lib/clubs";
import { cn, formatDate, formatNumber, formatPercent } from "@/lib/utils";

const POWER_FACTOR_LABELS: Record<string, string> = {
  Maj: "Major",
  Min: "Minor",
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ entry?: string }>;
}

export default async function PersonalMatchPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { entry: entryParam } = await searchParams;

  const { supabase, user } = await requireUser();
  const userId = user.id;

  const [match, myShooters, clubs] = await Promise.all([
    getMatchById(supabase, id),
    listMyShooters(supabase, userId),
    listClubs(supabase),
  ]);

  if (!match) {
    return (
      <PageContainer>
        <BackToDashboard />
        <Alert tone="warning" title="Match no encontrado">
          El torneo que estás buscando no existe o fue eliminado.
        </Alert>
      </PageContainer>
    );
  }

  if (myShooters.length === 0) {
    return (
      <PageContainer>
        <BackToDashboard />
        <Alert tone="warning" title="Asociá una participación a tu cuenta">
          Para ver tu detalle del match, primero buscá tu nombre en el ranking
          público y hacé click en “Soy yo”.{" "}
          <Link href={`/matches/${id}`} className="underline hover:text-fg">
            Ir al ranking del match
          </Link>
        </Alert>
      </PageContainer>
    );
  }

  // Una sola query trae TODAS las entries del usuario en este match (puede
  // tener varias si participó en varias divisiones, ej. FBI Pistola + PCC).
  const myEntries = await listMyEntriesInMatch(
    supabase,
    id,
    myShooters.map((s) => s.id),
  );

  if (myEntries.length === 0) {
    return (
      <PageContainer>
        <BackToDashboard />
        <Alert tone="warning" title="No participaste de este match">
          Ninguna de tus identidades aparece en el ranking de este torneo.{" "}
          <Link href={`/matches/${id}`} className="underline hover:text-fg">
            Ver ranking público
          </Link>
        </Alert>
      </PageContainer>
    );
  }

  // Resolver la entry seleccionada:
  //  - Si vino ?entry=ID en la URL (caso típico: clic desde "Tu historial"),
  //    intentamos esa.
  //  - Si no, default al primero (mejor match_percentage).
  const requestedEntry = entryParam
    ? myEntries.find((e) => e.id === entryParam)
    : undefined;
  const entry = requestedEntry ?? myEntries[0]!;

  const isTimeBased = isTimeBasedDiscipline(match.disciplines);
  const isHitsBased = isHitsBasedDiscipline(match.disciplines);
  const clubLookup = buildClubLookup(clubs);
  const clubCode = getClubCode(match.region);
  const clubName = getClubName(match.region, clubLookup);

  const [myFirearms, currentFirearmLog, stageResults] = await Promise.all([
    listMyFirearms(supabase, userId),
    getMatchFirearmLog(supabase, entry.id),
    listStageResultsForEntry(supabase, entry.id, id),
  ]);
  const suggestedRounds = estimateRoundsFired(
    match.disciplines?.code,
    stageResults.length,
  );

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

      {myEntries.length > 1 && (
        <DivisionSelector
          matchId={id}
          entries={myEntries}
          activeEntryId={entry.id}
        />
      )}

      {isTimeBased ? (
        <SteelSummaryCard entry={entry} />
      ) : isHitsBased ? (
        <FbiSummaryCard entry={entry} />
      ) : (
        <IpscSummaryCard entry={entry} />
      )}

      <FirearmSelector
        matchEntryId={entry.id}
        matchId={id}
        firearms={myFirearms}
        current={currentFirearmLog}
        suggestedRounds={suggestedRounds}
      />

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-fg-muted">
          Tus resultados por stage
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
        ) : isTimeBased ? (
          <SteelStagesTable stageResults={stageResults} />
        ) : isHitsBased ? (
          <FbiStagesTable stageResults={stageResults} />
        ) : (
          <IpscStagesTable stageResults={stageResults} />
        )}
      </section>
    </PageContainer>
  );
}

// ----------------------------------------------------------------------------
// Resumen y tablas: una variante por tipo de scoring
// ----------------------------------------------------------------------------

type EntrySummary = MyMatchSummary["entry"];

function IpscSummaryCard({ entry }: { entry: EntrySummary }) {
  return (
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
          {entry.is_dq ? (
            <Badge tone="danger">DQ</Badge>
          ) : entry.is_absent ? (
            <Badge tone="default">Ausente</Badge>
          ) : (
            entry.place
          )}
        </Stat>
        <Stat label="Match %" mono>
          {entry.is_dq || entry.is_absent
            ? "—"
            : formatPercent(entry.match_percentage)}
        </Stat>
      </div>
    </Card>
  );
}

function SteelSummaryCard({ entry }: { entry: EntrySummary }) {
  return (
    <Card className="mb-8">
      <div className="grid grid-cols-2 gap-6 p-5 sm:grid-cols-5">
        <Stat label="División">
          {entry.divisions ? (
            <span title={entry.divisions.name}>{entry.divisions.name}</span>
          ) : (
            "—"
          )}
        </Stat>
        <Stat label="Categoría">{entry.category ?? "General"}</Stat>
        <Stat label="Puesto">
          {entry.is_dq ? (
            <Badge tone="danger">DQ</Badge>
          ) : entry.is_absent ? (
            <Badge tone="default">Ausente</Badge>
          ) : (
            entry.place
          )}
        </Stat>
        <Stat label="Tiempo total" mono>
          {entry.is_dq || entry.is_absent || entry.total_time_seconds == null
            ? "—"
            : `${formatNumber(entry.total_time_seconds, 2)}s`}
        </Stat>
        <Stat label="Match %" mono>
          {entry.is_dq || entry.is_absent
            ? "—"
            : formatPercent(entry.match_percentage)}
        </Stat>
      </div>
    </Card>
  );
}

function IpscStagesTable({ stageResults }: { stageResults: MyMatchSummary["stageResults"] }) {
  return (
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
                <span className="font-medium">{stageLabel(r)}</span>
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
  );
}

function SteelStagesTable({ stageResults }: { stageResults: MyMatchSummary["stageResults"] }) {
  return (
    <Card className="overflow-hidden">
      <Table>
        <THead>
          <TR>
            <TH>Stage</TH>
            <TH className="text-right">Puesto</TH>
            <TH className="text-right">Tiempo</TH>
            <TH className="text-right">Stage %</TH>
          </TR>
        </THead>
        <TBody>
          {stageResults.map((r) => (
            <TR key={r.id}>
              <TD>
                <span className="font-medium">{stageLabel(r)}</span>
                {r.stages?.name && r.stages.stage_number != null && (
                  <span className="ml-2 text-xs text-fg-muted">
                    {r.stages.name}
                  </span>
                )}
              </TD>
              <TD className="text-right font-mono">
                {r.is_dq ? <Badge tone="danger">DQ</Badge> : r.place ?? "—"}
              </TD>
              <TD className="text-right font-mono">
                {r.time_seconds != null
                  ? `${formatNumber(r.time_seconds, 2)}s`
                  : "—"}
              </TD>
              <TD className="text-right font-mono">
                {r.is_dq ? "—" : formatPercent(r.stage_percentage)}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

/**
 * Resumen FBI: el dato primario es Impactos (criterio de ranking). Puntos y %
 * quedan más muteados — coherente con el detalle público del match.
 */
function FbiSummaryCard({ entry }: { entry: EntrySummary }) {
  return (
    <Card className="mb-8">
      <div className="grid grid-cols-2 gap-6 p-5 sm:grid-cols-5">
        <Stat label="División">
          {entry.divisions ? (
            <span title={entry.divisions.name}>{entry.divisions.name}</span>
          ) : (
            "—"
          )}
        </Stat>
        <Stat label="Categoría">{entry.category ?? "General"}</Stat>
        <Stat label="Puesto">
          {entry.is_dq ? (
            <Badge tone="danger">DQ</Badge>
          ) : entry.is_absent ? (
            <Badge tone="default">Ausente</Badge>
          ) : (
            entry.place
          )}
        </Stat>
        <Stat label="Impactos" mono>
          {entry.is_dq || entry.is_absent || entry.hits == null
            ? "—"
            : `${entry.hits}/40`}
        </Stat>
        <Stat label="Puntos" mono>
          {entry.is_dq || entry.is_absent
            ? "—"
            : formatNumber(entry.match_points, 0)}
        </Stat>
      </div>
    </Card>
  );
}

/**
 * Tabla de stages para FBI. Muestra impactos por stage (0..5) destacados,
 * más puntos y % como datos secundarios. No hay tiempo ni hit factor.
 */
function FbiStagesTable({
  stageResults,
}: {
  stageResults: MyMatchSummary["stageResults"];
}) {
  return (
    <Card className="overflow-hidden">
      <Table>
        <THead>
          <TR>
            <TH>Stage</TH>
            <TH className="text-right">Puesto</TH>
            <TH className="text-right">Impactos</TH>
            <TH className="text-right">Puntos</TH>
            <TH className="text-right">Stage %</TH>
          </TR>
        </THead>
        <TBody>
          {stageResults.map((r) => (
            <TR key={r.id}>
              <TD>
                <span className="font-medium">{stageLabel(r)}</span>
              </TD>
              <TD className="text-right font-mono">
                {r.is_dq ? <Badge tone="danger">DQ</Badge> : r.place ?? "—"}
              </TD>
              <TD className="text-right font-mono font-semibold text-fg">
                {r.is_dq || r.hits == null ? "—" : `${r.hits}/5`}
              </TD>
              <TD className="text-right font-mono text-fg-muted">
                {r.is_dq ? "—" : formatNumber(r.stage_points, 0)}
              </TD>
              <TD className="text-right font-mono text-fg-muted">
                {r.is_dq ? "—" : formatPercent(r.stage_percentage)}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

function stageLabel(r: MyMatchSummary["stageResults"][number]) {
  if (r.stages?.stage_number != null) return `Stage ${r.stages.stage_number}`;
  return r.stages?.name ?? "—";
}

function DivisionSelector({
  matchId,
  entries,
  activeEntryId,
}: {
  matchId: string;
  entries: MyMatchSummary["entry"][];
  activeEntryId: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-fg-muted">
        Tenés {entries.length} participaciones en este match:
      </span>
      {entries.map((e) => {
        const isActive = e.id === activeEntryId;
        const label = e.divisions?.code ?? "?";
        return (
          <Link
            key={e.id}
            href={`/matches/${matchId}/me?entry=${e.id}`}
            scroll={false}
            className={cn(
              "rounded-full border px-3 py-0.5 text-xs font-medium transition-colors",
              isActive
                ? "border-accent bg-accent-soft text-accent"
                : "border-border text-fg-muted hover:bg-surface-2 hover:text-fg",
            )}
            title={e.divisions?.name ?? undefined}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}

function BackToDashboard() {
  return (
    <Link
      href="/dashboard"
      className="mb-4 inline-block text-sm text-fg-muted hover:text-accent"
    >
      ← Volver a mis estadísticas
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
