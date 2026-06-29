import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Card } from "@/components/ui/Card";
import { PerformanceChart } from "@/components/PerformanceChart";
import { cn, formatPercent, formatDate } from "@/lib/utils";
import { isPenaltyTrackingDiscipline } from "@/lib/disciplines";
import {
  getAmmoExtrasTier,
  type AmmoEfficiencyStats,
  type AmmoExtrasTier,
  type CadenceStats,
  type ShooterStats,
} from "@/lib/stats/shooter-stats";

// Misma escala que HistoryTable / match-me — tocar los thresholds solo
// en `getAmmoExtrasTier` para mantener coherencia entre surfaces.
const EXTRAS_TIER_CLASS: Record<AmmoExtrasTier, string> = {
  perfect: "text-success",
  neutral: "",
  warning: "text-accent",
  danger: "text-danger",
};
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

type StatsT = Awaited<ReturnType<typeof getTranslations<"dashboard.stats">>>;

/**
 * Bloque de KPIs + chart para el historial del tirador.
 * Se renderiza solo si hay al menos un torneo válido (no DQ).
 *
 * Métrica primaria:
 *  - `"percentage"` (default): la fila superior y los KPIs derivados
 *    (consistencia/tendencia) usan Match %. Caso por defecto para vistas
 *    consolidadas e IPSC/Steel.
 *  - `"hits"`: la fila superior y los derivados usan impactos. Se activa
 *    en vistas FBI-only, donde los impactos son el criterio primario.
 *
 * Si hay matches con `hits` y la vista NO es FBI-only, agregamos igual una
 * fila extra de 4 KPIs de impactos para que el tirador siga viendo su
 * progreso por esa dimensión.
 */
export async function StatsOverview({
  stats,
  primaryMetric = "percentage",
}: {
  stats: ShooterStats;
  primaryMetric?: "percentage" | "hits";
}) {
  if (stats.scoredMatches === 0) return null;

  const t = await getTranslations("dashboard.stats");

  const hitsTimelineCount = stats.timeline.filter((p) => p.hits !== null).length;
  const hasHits = hitsTimelineCount >= 2;
  const showHitsAsPrimary = primaryMetric === "hits" && hasHits;
  // Si los hits son la primaria, no necesitamos una fila extra.
  const showHitsExtraRow = !showHitsAsPrimary && hasHits;

  // Desglosamos la diferencia entre `totalMatches` y `scoredMatches` en DQ
  // vs ausencia para que el hint del KPI sea preciso (antes decía "DQ"
  // genérico aunque fueran ausencias).
  const dqCount = stats.timeline.filter((p) => p.isDq).length;
  const absentCount = stats.timeline.filter((p) => p.isAbsent).length;
  const invalidParts: string[] = [];
  if (dqCount > 0) invalidParts.push(t("dqCount", { count: dqCount }));
  if (absentCount > 0) {
    invalidParts.push(t("absentCount", { count: absentCount }));
  }
  const invalidHint =
    invalidParts.length > 0
      ? t("invalidHint", {
          scored: stats.scoredMatches,
          parts: invalidParts.join(" · "),
        })
      : undefined;

  return (
    <div className="space-y-4">
      {/* Fila 1: performance — métrica primaria */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t("matchesPlayed")}
          value={String(stats.totalMatches)}
          hint={invalidHint}
        />

        {showHitsAsPrimary ? (
          <>
            <KpiCard
              label={t("avgHits")}
              value={stats.avgHits !== null ? stats.avgHits.toFixed(1) : "—"}
              hint={t("avgHitsHint", { count: hitsTimelineCount })}
            />
            <KpiCard
              label={t("bestHits")}
              value={stats.bestHits ? String(stats.bestHits.value) : "—"}
              hint={
                stats.bestHits ? (
                  <Link
                    href={`/matches/${stats.bestHits.matchId}/me`}
                    className="hover:text-accent"
                    title={stats.bestHits.matchName}
                  >
                    {formatDate(stats.bestHits.date)}
                  </Link>
                ) : undefined
              }
            />
          </>
        ) : (
          <>
            <KpiCard
              label={t("avgPct")}
              value={formatPercent(stats.avgPercentage)}
              hint={
                stats.topDivision
                  ? t("topDivHint", { code: stats.topDivision.code })
                  : undefined
              }
            />
            <KpiCard
              label={t("bestPct")}
              value={
                stats.bestPercentage
                  ? formatPercent(stats.bestPercentage.value)
                  : "—"
              }
              hint={
                stats.bestPercentage ? (
                  <Link
                    href={`/matches/${stats.bestPercentage.matchId}/me`}
                    className="hover:text-accent"
                    title={stats.bestPercentage.matchName}
                  >
                    {formatDate(stats.bestPercentage.date)}
                  </Link>
                ) : undefined
              }
            />
          </>
        )}

        <KpiCard
          label={t("bestPlace")}
          value={stats.bestPlace ? `#${stats.bestPlace.value}` : "—"}
          hint={
            stats.bestPlace ? (
              <Link
                href={`/matches/${stats.bestPlace.matchId}/me`}
                className="hover:text-accent"
                title={stats.bestPlace.matchName}
              >
                {formatDate(stats.bestPlace.date)}
              </Link>
            ) : undefined
          }
        />
      </div>

      {/* Fila extra de impactos: solo en vistas donde no son la primaria
          pero igual hay datos (ej. consolidado con FBI mezclado). */}
      {showHitsExtraRow && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label={t("avgHits")}
            value={stats.avgHits !== null ? stats.avgHits.toFixed(1) : "—"}
            hint={t("avgHitsHintFbi", { count: hitsTimelineCount })}
          />
          <KpiCard
            label={t("bestHits")}
            value={stats.bestHits ? String(stats.bestHits.value) : "—"}
            hint={
              stats.bestHits ? (
                <Link
                  href={`/matches/${stats.bestHits.matchId}/me`}
                  className="hover:text-accent"
                  title={stats.bestHits.matchName}
                >
                  {formatDate(stats.bestHits.date)}
                </Link>
              ) : undefined
            }
          />
          <ConsistencyHitsCard value={stats.consistencyHits} t={t} />
          <SlopeHitsCard slope={stats.trajectoryHitsSlope} t={t} />
        </div>
      )}

      {/* Fila 2: KPIs derivados — consistencia / tendencia siguen primaryMetric */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PercentileCard avg={stats.avgPercentile} best={stats.bestPercentile} t={t} />
        {showHitsAsPrimary ? (
          <>
            <ConsistencyHitsCard value={stats.consistencyHits} t={t} />
            <SlopeHitsCard slope={stats.trajectoryHitsSlope} t={t} />
          </>
        ) : (
          <>
            <ConsistencyCard value={stats.consistency} t={t} />
            <SlopeCard slope={stats.trajectorySlope} t={t} />
          </>
        )}
        <CadenceCard cadence={stats.cadence} t={t} />
      </div>

      {/* Por stage: KPIs cross-matches a nivel de stage (podios, ganados,
          penalties opcional, mejor %). Aparece solo cuando hay
          stage_results. La card de penalties la rendereamos solo en
          disciplinas que realmente las trackean (IPSC, Combat) — esconderla
          en FBI/Steel evita el ruido del "no aplica" que confundía al user.
          El grid usa N columnas en lg según cuántas cards van: si son 3
          (sin penalties) las cards se reparten parejas en la fila sin dejar
          hueco a la derecha. */}
      {stats.stageStats && (() => {
        const showPenalties = stats.byDiscipline.some((d) =>
          isPenaltyTrackingDiscipline(d.code),
        );
        const gridLg = showPenalties ? "lg:grid-cols-4" : "lg:grid-cols-3";
        return (
          <div className={cn("grid gap-3 sm:grid-cols-2", gridLg)}>
            <KpiCard
              label={t("podiumsPerStage")}
              value={`${stats.stageStats!.podiumRate.toFixed(0)}%`}
              hint={t("podiumsHint", { count: stats.stageStats!.scoredStages })}
            />
            <KpiCard
              label={t("stagesWon")}
              value={`${stats.stageStats!.winRate.toFixed(0)}%`}
              hint={t("stagesWonHint")}
            />
            {showPenalties && (
              <PenaltyRateCard
                rate={stats.stageStats!.penaltyRate}
                tracksPenalties={true}
                t={t}
              />
            )}
            <KpiCard
              label={t("bestStagePct")}
              value={formatPercent(stats.stageStats!.bestStagePercentage)}
              hint={t("bestStagePctHint")}
            />
          </div>
        );
      })()}

      {/*
        Eficiencia de munición (issue #75): promedio y acumulado de disparos
        extra. Solo aparece cuando hay datos (al menos 1 entry con
        min_shots + rounds_fired). Si N<3 mostramos el N para que el
        usuario sepa que la muestra es chica.
      */}
      {stats.ammoEfficiency && (
        <div className="grid gap-3 sm:grid-cols-2">
          <AmmoAvgExtrasCard ammo={stats.ammoEfficiency} t={t} />
          <AmmoTotalExtrasCard ammo={stats.ammoEfficiency} t={t} />
        </div>
      )}

      {/*
        Charts de evolución. El orden + colapsabilidad depende de la métrica
        primaria:
          - primary = %: chart de % visible, chart de impactos (si hay datos
            FBI mezclados) visible debajo como dimensión extra.
          - primary = hits (FBI-only): chart de impactos visible, chart de %
            colapsado dentro de <details> — para un user FBI el puntaje es
            secundario y mostrarlo siempre desplegado agrega ruido.
      */}
      {showHitsAsPrimary ? (
        <>
          <Card className="px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
              {t("hitsEvolution")}
            </p>
            {stats.timeline.length >= 2 ? (
              <PerformanceChart points={stats.timeline} mode="hits" />
            ) : (
              <p className="mt-3 text-sm text-fg-subtle">
                {t("needTwoMatches")}
              </p>
            )}
          </Card>
          <Card className="px-5 py-4">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium uppercase tracking-wider text-fg-muted">
                <span className="transition-transform group-open:rotate-90" aria-hidden>
                  ▸
                </span>
                {t("alsoSeePctEvolution")}
              </summary>
              <div className="mt-3">
                {stats.timeline.length >= 2 ? (
                  <PerformanceChart points={stats.timeline} mode="percentage" />
                ) : (
                  <p className="text-sm text-fg-subtle">
                    {t("needTwoMatches")}
                  </p>
                )}
              </div>
            </details>
          </Card>
        </>
      ) : (
        <>
          <Card className="px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
              {t("pctEvolution")}
            </p>
            {stats.timeline.length >= 2 ? (
              <PerformanceChart points={stats.timeline} mode="percentage" />
            ) : (
              <p className="mt-3 text-sm text-fg-subtle">
                {t("needTwoMatches")}
              </p>
            )}
          </Card>

          {hasHits && (
            <Card className="px-5 py-4">
              <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                {t("hitsEvolution")}
              </p>
              <PerformanceChart points={stats.timeline} mode="hits" />
            </Card>
          )}
        </>
      )}

      {stats.byDiscipline.length > 1 && (
        <Card className="px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
            {t("byDiscipline")}
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {stats.byDiscipline.map((d) => (
              <li
                key={d.code}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{d.name}</p>
                  <p className="text-xs text-fg-muted">
                    {t("matchesCount", { count: d.count })}
                  </p>
                </div>
                <div className="text-right text-xs">
                  <p className="font-mono text-fg">
                    {formatPercent(d.avgPercentage)}
                  </p>
                  <p className="text-fg-subtle">
                    {t("max", { value: formatPercent(d.bestPercentage) })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// KPI cards
// ----------------------------------------------------------------------------

function KpiCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: string;
}) {
  return (
    <Card className="px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
        {label}
      </p>
      <p
        className={cn(
          "mt-1.5 font-mono text-2xl font-semibold tabular-nums",
          tone,
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 truncate text-xs text-fg-subtle">{hint}</p>}
    </Card>
  );
}

function PercentileCard({
  avg,
  best,
  t,
}: {
  avg: number | null;
  best: ShooterStats["bestPercentile"];
  t: StatsT;
}) {
  if (avg === null) {
    return (
      <KpiCard
        label={t("percentileLabel")}
        value="—"
        hint={t("percentileNoData")}
      />
    );
  }
  // `avgPercentile` viene como place/total × 100 (menor = mejor: place=1
  // produce el percentil más bajo). Lo invertimos para mostrarlo como
  // "% de la división que superás" — convención positiva (mayor = mejor)
  // que evita la ambigüedad de "Top 71%" sonando como mediocre o como
  // élite según se interprete.
  const surpassedAvg = 100 - avg;
  return (
    <KpiCard
      label={t("percentileLabel")}
      value={`${surpassedAvg.toFixed(0)}%`}
      hint={
        best ? (
          <Link
            href={`/matches/${best.matchId}/me`}
            className="hover:text-accent"
            title={best.matchName}
          >
            {t("percentileBest", {
              value: (100 - best.value).toFixed(0),
              date: formatDate(best.date),
            })}
          </Link>
        ) : (
          t("percentileHigherBetter")
        )
      }
    />
  );
}

function ConsistencyCard({ value, t }: { value: number | null; t: StatsT }) {
  if (value === null) {
    return (
      <KpiCard
        label={t("consistency")}
        value="—"
        hint={t("consistencyNoData")}
      />
    );
  }
  // Convención: <10 sólido, 10-20 normal, >20 volátil.
  const tag =
    value < 10 ? t("tagSolid") : value < 20 ? t("tagNormal") : t("tagVolatile");
  return (
    <KpiCard
      label={t("consistency")}
      value={`±${value.toFixed(1)}%`}
      hint={t("consistencyHint", { tag })}
    />
  );
}

function ConsistencyHitsCard({ value, t }: { value: number | null; t: StatsT }) {
  if (value === null) {
    return (
      <KpiCard
        label={t("consistencyHits")}
        value="—"
        hint={t("consistencyHitsNoData")}
      />
    );
  }
  // FBI: 40 impactos máx. Umbrales: <2 sólido, 2-5 normal, >5 volátil.
  const tag =
    value < 2 ? t("tagSolid") : value < 5 ? t("tagNormal") : t("tagVolatile");
  return (
    <KpiCard
      label={t("consistencyHits")}
      value={`±${value.toFixed(1)}`}
      hint={t("consistencyHint", { tag })}
    />
  );
}

function SlopeCard({ slope, t }: { slope: number | null; t: StatsT }) {
  if (slope === null) {
    return (
      <KpiCard
        label={t("trend")}
        value="—"
        hint={t("trendNoData")}
      />
    );
  }

  // Umbral pequeño para considerarla "estable".
  const ABS_THRESHOLD = 0.3;
  const isFlat = Math.abs(slope) < ABS_THRESHOLD;
  const isUp = !isFlat && slope > 0;
  const Icon = isFlat ? Minus : isUp ? TrendingUp : TrendingDown;
  const tone = isFlat
    ? "text-fg-muted"
    : isUp
      ? "text-success"
      : "text-danger";
  const sign = slope > 0 ? "+" : "";

  return (
    <Card className="px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
        {t("trend")}
      </p>
      <p
        className={cn(
          "mt-1.5 inline-flex items-center gap-1.5 font-mono text-2xl font-semibold tabular-nums",
          tone,
        )}
      >
        <Icon className="h-5 w-5" aria-hidden />
        {isFlat ? t("stable") : `${sign}${slope.toFixed(1)}%`}
      </p>
      <p className="mt-1 text-xs text-fg-subtle">
        {isFlat ? t("trendStableHint") : t("trendPctHint")}
      </p>
    </Card>
  );
}

function SlopeHitsCard({ slope, t }: { slope: number | null; t: StatsT }) {
  if (slope === null) {
    return (
      <KpiCard
        label={t("trendHits")}
        value="—"
        hint={t("trendHitsNoData")}
      />
    );
  }
  // Umbrales: <0.1 impactos/torneo se considera plano.
  const ABS_THRESHOLD = 0.1;
  const isFlat = Math.abs(slope) < ABS_THRESHOLD;
  const isUp = !isFlat && slope > 0;
  const Icon = isFlat ? Minus : isUp ? TrendingUp : TrendingDown;
  const tone = isFlat
    ? "text-fg-muted"
    : isUp
      ? "text-success"
      : "text-danger";
  const sign = slope > 0 ? "+" : "";

  return (
    <Card className="px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
        {t("trendHits")}
      </p>
      <p
        className={cn(
          "mt-1.5 inline-flex items-center gap-1.5 font-mono text-2xl font-semibold tabular-nums",
          tone,
        )}
      >
        <Icon className="h-5 w-5" aria-hidden />
        {isFlat ? t("stable") : `${sign}${slope.toFixed(1)}`}
      </p>
      <p className="mt-1 text-xs text-fg-subtle">
        {isFlat ? t("trendStableHint") : t("trendHitsHint")}
      </p>
    </Card>
  );
}

function PenaltyRateCard({
  rate,
  tracksPenalties,
  t,
}: {
  rate: number | null;
  tracksPenalties: boolean;
  t: StatsT;
}) {
  if (rate === null) {
    // Distinguimos "no aplica" (FBI/Steel) de "aplica pero el archivo
    // importado no traía la columna `Pen`" (IPSC/Combat sin datos).
    // Mismo display "—" pero hint preciso para no engañar al usuario.
    return (
      <KpiCard
        label={t("penaltyRate")}
        value="—"
        hint={
          tracksPenalties
            ? t("penaltyNoDataTracks")
            : t("penaltyNoDataNotApplicable")
        }
      />
    );
  }
  // Convención: <10% bajo, 10-25% normal, >25% alto.
  const tag = rate < 10 ? t("tagLow") : rate < 25 ? t("tagNormal") : t("tagHigh");
  return (
    <KpiCard
      label={t("penaltyRate")}
      value={`${rate.toFixed(0)}%`}
      hint={t("penaltyHint", { tag })}
    />
  );
}

/**
 * Tile de "Promedio disparos extra" (issue #75). El número es +N por entry
 * sobre el mínimo.
 *
 * Color por tier: usamos el promedio total (`totalExtras` vs `totalMinShots`)
 * para calcular el %, así normaliza disciplinas con mínimos distintos
 * (FBI 45 vs IPSC 150). Mismos thresholds que el badge per-match:
 * 0=verde, ≤5%=default, ≤15%=amber, >15%=rojo.
 */
function AmmoAvgExtrasCard({ ammo, t }: { ammo: AmmoEfficiencyStats; t: StatsT }) {
  const avg = ammo.avgExtras;
  const sign = avg > 0 ? "+" : "";
  const tier = getAmmoExtrasTier(ammo.totalExtras, ammo.totalMinShots);
  const sampleHint =
    ammo.matchCount < 3
      ? t("avgExtraShotsHintSmall", { count: ammo.matchCount })
      : t("avgExtraShotsHint", { count: ammo.matchCount });
  return (
    <KpiCard
      label={t("avgExtraShots")}
      value={`${sign}${avg.toFixed(1)}`}
      hint={sampleHint}
      tone={EXTRAS_TIER_CLASS[tier] || undefined}
    />
  );
}

/**
 * Tile de "Disparos extra acumulados" (issue #75). Es el desperdicio total
 * traducible a costo de munición. Usamos el mismo tier que el avg
 * (basado en el %) en lugar de "cualquier >0 es rojo" — sino un tirador
 * con muchos matches y promedio bajo terminaba con total visualmente
 * alarmante aunque la eficiencia fuera buena.
 */
function AmmoTotalExtrasCard({ ammo, t }: { ammo: AmmoEfficiencyStats; t: StatsT }) {
  const total = ammo.totalExtras;
  const sign = total > 0 ? "+" : "";
  const tier = getAmmoExtrasTier(ammo.totalExtras, ammo.totalMinShots);
  return (
    <KpiCard
      label={t("totalExtraShots")}
      value={`${sign}${total}`}
      hint={t("totalExtraShotsHint", { count: ammo.matchCount })}
      tone={EXTRAS_TIER_CLASS[tier] || undefined}
    />
  );
}

function CadenceCard({ cadence, t }: { cadence: CadenceStats | null; t: StatsT }) {
  if (!cadence) {
    return <KpiCard label={t("cadence")} value="—" hint={t("cadenceNoMatches")} />;
  }
  const days = cadence.daysSinceLastMatch;
  const lastLabel =
    days === null
      ? null
      : days === 0
        ? t("lastToday")
        : days === 1
          ? t("lastYesterday")
          : days < 14
            ? t("lastDaysAgo", { count: days })
            : days < 60
              ? t("lastWeeksAgo", { count: Math.round(days / 7) })
              : t("lastMonthsAgo", { count: Math.round(days / 30) });

  return (
    <KpiCard
      label={t("cadence")}
      value={t("cadenceValue", { value: cadence.matchesPerMonth.toFixed(1) })}
      hint={
        lastLabel
          ? t("cadenceHint", { last: lastLabel })
          : t("cadenceHintNoLast")
      }
    />
  );
}
