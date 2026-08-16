import { Link } from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
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
import { listMyAmmo } from "@/lib/db/ammo";
import { estimateRoundsFired } from "@/lib/firearms/estimate-rounds";
import { BackLink } from "@/components/BackLink";
import { isHitsBasedDiscipline, isTimeBasedDiscipline } from "@/lib/disciplines";
import {
  getAmmoExtrasTier,
  type AmmoExtrasTier,
} from "@/lib/stats/shooter-stats";
import type { MyMatchSummary } from "@/lib/db/types";
import { buildClubLookup, getClubCode, getClubName } from "@/lib/clubs";
import { cn, formatDate, formatNumber, formatPercent } from "@/lib/utils";
import { PlaceCell } from "@/components/matches/PlaceCell";
import {
  MatchSummaryCard,
  PlacementStat,
  Stat,
} from "@/components/matches/MatchSummaryCard";
import {
  StageResultsTable,
  type StageColumn,
} from "@/components/matches/StageResultsTable";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ entry?: string }>;
}

export default async function PersonalMatchPage({
  params,
  searchParams,
}: PageProps) {
  const locale = await getLocale();
  const t = await getTranslations("matches");
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
        <BackLink fallbackHref="/dashboard" />
        <Alert tone="warning" title={t("me.notFoundTitle")}>
          {t("me.notFoundBody")}
        </Alert>
      </PageContainer>
    );
  }

  if (myShooters.length === 0) {
    return (
      <PageContainer>
        <BackLink fallbackHref="/dashboard" />
        <Alert tone="warning" title={t("me.linkTitle")}>
          {t("me.linkBody")}{" "}
          <Link href={`/matches/${id}`} className="underline hover:text-fg">
            {t("me.linkCta")}
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
        <BackLink fallbackHref="/dashboard" />
        <Alert tone="warning" title={t("me.noEntryTitle")}>
          {t("me.noEntryBody")}{" "}
          <Link href={`/matches/${id}`} className="underline hover:text-fg">
            {t("me.noEntryCta")}
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

  const [myFirearms, myAmmo, currentFirearmLog, stageResults] =
    await Promise.all([
      listMyFirearms(supabase, userId),
      listMyAmmo(supabase, userId),
      getMatchFirearmLog(supabase, entry.id),
      listStageResultsForEntry(supabase, entry.id, id),
    ]);
  const suggestedRounds = estimateRoundsFired(
    match.disciplines?.code,
    stageResults.length,
  );

  return (
    <PageContainer>
      <BackLink fallbackHref="/dashboard" />

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{match.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
            <span className="font-mono">{formatDate(match.date, locale)}</span>
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
          {t("me.publicRanking")}
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
        ammo={myAmmo}
        current={currentFirearmLog}
        suggestedRounds={suggestedRounds}
      />

      <AmmoEfficiencyCard
        minShots={match.min_shots}
        roundsFired={currentFirearmLog?.rounds_fired ?? null}
      />

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-fg-muted">
          {t("me.stageResults")}
        </h2>

        {stageResults.length === 0 ? (
          <Card className="p-10 text-center">
            <p className="text-fg-muted">{t("me.stagesEmpty")}</p>
            <p className="mt-2 text-xs text-fg-subtle">
              {t.rich("me.stagesEmptyHint", {
                code: (chunks) => <code>{chunks}</code>,
              })}
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

async function IpscSummaryCard({ entry }: { entry: EntrySummary }) {
  const t = await getTranslations("matches");
  const tc = await getTranslations("common");
  return (
    <MatchSummaryCard>
      <Stat label={t("summary.division")}>
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
      <Stat label={t("summary.factor")}>
        {/* Spelled out rather than a lookup table: a computed key cannot be
            checked against the catalogue — see `translation-keys.test.ts`. */}
        {entry.power_factor === "Maj"
          ? tc("powerFactorMajor")
          : entry.power_factor === "Min"
            ? tc("powerFactorMinor")
            : "—"}
      </Stat>
      <Stat label={t("detail.colCategory")}>
        {entry.category ?? tc("categoryGeneral")}
      </Stat>
      <PlacementStat
        isDq={entry.is_dq}
        isAbsent={entry.is_absent}
        place={entry.place}
      />
      <Stat label={t("summary.matchPercent")} mono>
        {entry.is_dq || entry.is_absent
          ? "—"
          : formatPercent(entry.match_percentage)}
      </Stat>
    </MatchSummaryCard>
  );
}

async function SteelSummaryCard({ entry }: { entry: EntrySummary }) {
  const t = await getTranslations("matches");
  const tc = await getTranslations("common");
  return (
    <MatchSummaryCard>
      <Stat label={t("summary.division")}>
        {entry.divisions ? (
          <span title={entry.divisions.name}>{entry.divisions.name}</span>
        ) : (
          "—"
        )}
      </Stat>
      <Stat label={t("detail.colCategory")}>
        {entry.category ?? tc("categoryGeneral")}
      </Stat>
      <PlacementStat
        isDq={entry.is_dq}
        isAbsent={entry.is_absent}
        place={entry.place}
      />
      <Stat label={t("summary.totalTime")} mono>
        {entry.is_dq || entry.is_absent || entry.total_time_seconds == null
          ? "—"
          : `${formatNumber(entry.total_time_seconds, 2)}s`}
      </Stat>
      <Stat label={t("summary.matchPercent")} mono>
        {entry.is_dq || entry.is_absent
          ? "—"
          : formatPercent(entry.match_percentage)}
      </Stat>
    </MatchSummaryCard>
  );
}

async function IpscStagesTable({ stageResults }: { stageResults: MyMatchSummary["stageResults"] }) {
  const t = await getTranslations("matches");
  const columns: StageColumn[] = [
    {
      header: t("detail.colStage"),
      cell: (r) => <span className="font-medium">{stageLabel(r, t)}</span>,
    },
    {
      header: t("summary.place"),
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      cell: (r) => <PlaceCell isDq={r.is_dq} place={r.place} showAbsent={false} />,
    },
    {
      header: t("detail.colTime"),
      headerClassName: "text-right",
      cellClassName: "text-right font-mono text-fg-muted",
      cell: (r) =>
        r.time_seconds != null ? `${formatNumber(r.time_seconds, 2)}s` : "—",
    },
    {
      header: t("detail.colPoints"),
      headerClassName: "text-right",
      cellClassName: "text-right font-mono text-fg-muted",
      cell: (r) => formatNumber(r.points, 0),
    },
    {
      header: t("detail.colPenalties"),
      headerClassName: "text-right",
      cellClassName: "text-right font-mono text-fg-muted",
      cell: (r) =>
        r.penalties && Number(r.penalties) > 0 ? (
          <span className="text-danger">{formatNumber(r.penalties, 0)}</span>
        ) : (
          formatNumber(r.penalties, 0)
        ),
    },
    {
      header: t("detail.colHitFactor"),
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      cell: (r) => formatNumber(r.hit_factor, 4),
    },
    {
      header: t("detail.colStagePoints"),
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      cell: (r) => formatNumber(r.stage_points, 2),
    },
    {
      header: t("detail.colStagePercent"),
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      cell: (r) => (r.is_dq ? "—" : formatPercent(r.stage_percentage)),
    },
  ];
  return <StageResultsTable stageResults={stageResults} columns={columns} />;
}

async function SteelStagesTable({ stageResults }: { stageResults: MyMatchSummary["stageResults"] }) {
  const t = await getTranslations("matches");
  const columns: StageColumn[] = [
    {
      header: t("detail.colStage"),
      cell: (r) => (
        <>
          <span className="font-medium">{stageLabel(r, t)}</span>
          {r.stages?.name && r.stages.stage_number != null && (
            <span className="ml-2 text-xs text-fg-muted">{r.stages.name}</span>
          )}
        </>
      ),
    },
    {
      header: t("summary.place"),
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      cell: (r) => <PlaceCell isDq={r.is_dq} place={r.place} showAbsent={false} />,
    },
    {
      header: t("detail.colTime"),
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      cell: (r) =>
        r.time_seconds != null ? `${formatNumber(r.time_seconds, 2)}s` : "—",
    },
    {
      header: t("detail.colStagePercent"),
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      cell: (r) => (r.is_dq ? "—" : formatPercent(r.stage_percentage)),
    },
  ];
  return <StageResultsTable stageResults={stageResults} columns={columns} />;
}

/**
 * Resumen FBI: el dato primario es Impactos (criterio de ranking). Puntos y %
 * quedan más muteados — coherente con el detalle público del match.
 */
async function FbiSummaryCard({ entry }: { entry: EntrySummary }) {
  const t = await getTranslations("matches");
  const tc = await getTranslations("common");
  return (
    <MatchSummaryCard>
      <Stat label={t("summary.division")}>
        {entry.divisions ? (
          <span title={entry.divisions.name}>{entry.divisions.name}</span>
        ) : (
          "—"
        )}
      </Stat>
      <Stat label={t("detail.colCategory")}>
        {entry.category ?? tc("categoryGeneral")}
      </Stat>
      <PlacementStat
        isDq={entry.is_dq}
        isAbsent={entry.is_absent}
        place={entry.place}
      />
      <Stat label={t("detail.colHits")} mono>
        {entry.is_dq || entry.is_absent || entry.hits == null
          ? "—"
          : `${entry.hits}/40`}
      </Stat>
      <Stat label={t("detail.colPoints")} mono>
        {entry.is_dq || entry.is_absent
          ? "—"
          : formatNumber(entry.match_points, 0)}
      </Stat>
    </MatchSummaryCard>
  );
}

/**
 * Tabla de stages para FBI. Muestra impactos por stage (0..5) destacados,
 * más puntos y % como datos secundarios. No hay tiempo ni hit factor.
 */
async function FbiStagesTable({
  stageResults,
}: {
  stageResults: MyMatchSummary["stageResults"];
}) {
  const t = await getTranslations("matches");
  const columns: StageColumn[] = [
    {
      header: t("detail.colStage"),
      cell: (r) => <span className="font-medium">{stageLabel(r, t)}</span>,
    },
    {
      header: t("summary.place"),
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      cell: (r) => <PlaceCell isDq={r.is_dq} place={r.place} showAbsent={false} />,
    },
    {
      header: t("detail.colHits"),
      headerClassName: "text-right",
      cellClassName: "text-right font-mono font-semibold text-fg",
      cell: (r) => (r.is_dq || r.hits == null ? "—" : `${r.hits}/5`),
    },
    {
      header: t("detail.colPoints"),
      headerClassName: "text-right",
      cellClassName: "text-right font-mono text-fg-muted",
      cell: (r) => (r.is_dq ? "—" : formatNumber(r.stage_points, 0)),
    },
    {
      header: t("detail.colStagePercent"),
      headerClassName: "text-right",
      cellClassName: "text-right font-mono text-fg-muted",
      cell: (r) => (r.is_dq ? "—" : formatPercent(r.stage_percentage)),
    },
  ];
  return <StageResultsTable stageResults={stageResults} columns={columns} />;
}

/**
 * Card de "eficiencia de munición" del entry (issue #75). Calcula los
 * disparos extra: `rounds_fired - min_shots`. 0 = perfecto, +N = N tiros
 * gastados por encima del mínimo (fallas, repasos de blanco, warmup
 * extra). Negativos serían "menos disparos que el mínimo" — físicamente
 * imposible si se completó el match, pero posible si el tirador registró
 * menos balas que las que tiró; mostramos el número igual sin tono de
 * alarma especial (es dato del usuario).
 *
 * Solo se renderiza si tenemos ambos: el match con `min_shots` poblado y
 * el log del arma con `rounds_fired`. Si falta cualquiera, no devolvemos
 * nada (es preferible no mostrar que mostrar un placeholder confuso).
 */
// Tier → color de texto. Misma escala que HistoryTable y StatsOverview —
// si tocás los thresholds, mantenelos en `getAmmoExtrasTier` para que
// todos los surfaces queden coherentes.
const EXTRAS_TIER_CLASS: Record<AmmoExtrasTier, string> = {
  perfect: "text-success",
  neutral: "",
  warning: "text-accent",
  danger: "text-danger",
};

async function AmmoEfficiencyCard({
  minShots,
  roundsFired,
}: {
  minShots: number | null;
  roundsFired: number | null;
}) {
  if (minShots == null || roundsFired == null) return null;
  const t = await getTranslations("matches");
  const extras = roundsFired - minShots;
  const tier = getAmmoExtrasTier(extras, minShots);
  return (
    <Card className="mb-8 p-5">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
            {t("me.extraShots")}
          </p>
          <p
            className={cn(
              "mt-1 font-mono text-2xl font-semibold tabular-nums",
              EXTRAS_TIER_CLASS[tier],
            )}
          >
            {extras > 0 ? `+${extras}` : extras}
          </p>
        </div>
        <p className="text-right text-sm text-fg-muted">
          <span className="font-mono">{minShots}</span> {t("me.extrasMin")}
          <span className="mx-1.5 text-fg-subtle">/</span>
          <span className="font-mono">{roundsFired}</span> {t("me.extrasUsed")}
        </p>
      </div>
    </Card>
  );
}

function stageLabel(
  r: MyMatchSummary["stageResults"][number],
  t: (key: "detail.stage", values: { n: number }) => string,
) {
  if (r.stages?.stage_number != null)
    return t("detail.stage", { n: r.stages.stage_number });
  return r.stages?.name ?? "—";
}

async function DivisionSelector({
  matchId,
  entries,
  activeEntryId,
}: {
  matchId: string;
  entries: MyMatchSummary["entry"][];
  activeEntryId: string;
}) {
  const t = await getTranslations("matches");
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-fg-muted">
        {t("me.multipleEntries", { count: entries.length })}
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

