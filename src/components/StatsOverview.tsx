import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { PerformanceChart } from "@/components/PerformanceChart";
import { cn, formatPercent, formatDate } from "@/lib/utils";
import type { CadenceStats, ShooterStats } from "@/lib/stats/shooter-stats";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

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
export function StatsOverview({
  stats,
  primaryMetric = "percentage",
}: {
  stats: ShooterStats;
  primaryMetric?: "percentage" | "hits";
}) {
  if (stats.scoredMatches === 0) return null;

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
  if (dqCount > 0) invalidParts.push(`${dqCount} DQ`);
  if (absentCount > 0) {
    invalidParts.push(`${absentCount} ausente${absentCount === 1 ? "" : "s"}`);
  }
  const invalidHint =
    invalidParts.length > 0
      ? `${stats.scoredMatches} válidos · ${invalidParts.join(" · ")}`
      : undefined;

  return (
    <div className="space-y-4">
      {/* Fila 1: performance — métrica primaria */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Torneos disputados"
          value={String(stats.totalMatches)}
          hint={invalidHint}
        />

        {showHitsAsPrimary ? (
          <>
            <KpiCard
              label="Promedio impactos"
              value={stats.avgHits !== null ? stats.avgHits.toFixed(1) : "—"}
              hint={`sobre ${hitsTimelineCount} torneo${hitsTimelineCount === 1 ? "" : "s"}`}
            />
            <KpiCard
              label="Mejor impactos"
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
              label="Promedio %"
              value={formatPercent(stats.avgPercentage)}
              hint={
                stats.topDivision
                  ? `Top div: ${stats.topDivision.code}`
                  : undefined
              }
            />
            <KpiCard
              label="Mejor %"
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
          label="Mejor puesto"
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
            label="Promedio impactos"
            value={stats.avgHits !== null ? stats.avgHits.toFixed(1) : "—"}
            hint={`sobre ${hitsTimelineCount} torneo${hitsTimelineCount === 1 ? "" : "s"} FBI`}
          />
          <KpiCard
            label="Mejor impactos"
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
          <ConsistencyHitsCard value={stats.consistencyHits} />
          <SlopeHitsCard slope={stats.trajectoryHitsSlope} />
        </div>
      )}

      {/* Fila 2: KPIs derivados — consistencia / tendencia siguen primaryMetric */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PercentileCard avg={stats.avgPercentile} best={stats.bestPercentile} />
        {showHitsAsPrimary ? (
          <>
            <ConsistencyHitsCard value={stats.consistencyHits} />
            <SlopeHitsCard slope={stats.trajectoryHitsSlope} />
          </>
        ) : (
          <>
            <ConsistencyCard value={stats.consistency} />
            <SlopeCard slope={stats.trajectorySlope} />
          </>
        )}
        <CadenceCard cadence={stats.cadence} />
      </div>

      {/* Por stage: KPIs cross-matches a nivel de stage (top 3, ganados,
          penalties, mejor %). Aparece solo cuando hay stage_results. */}
      {stats.stageStats && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Tasa de podios"
            value={`${stats.stageStats.podiumRate.toFixed(0)}%`}
            hint={`stages top 3 · ${stats.stageStats.scoredStages} contabilizados`}
          />
          <KpiCard
            label="Stages ganados"
            value={`${stats.stageStats.winRate.toFixed(0)}%`}
            hint="stages con #1"
          />
          <PenaltyRateCard rate={stats.stageStats.penaltyRate} />
          <KpiCard
            label="Mejor stage %"
            value={formatPercent(stats.stageStats.bestStagePercentage)}
            hint="máximo % de stage"
          />
        </div>
      )}

      {/* Chart de evolución del Match % */}
      <Card className="px-5 py-4">
        <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
          Evolución del %
        </p>
        {stats.timeline.length >= 2 ? (
          <PerformanceChart points={stats.timeline} mode="percentage" />
        ) : (
          <p className="mt-3 text-sm text-fg-subtle">
            Necesitás al menos 2 torneos para ver la evolución.
          </p>
        )}
      </Card>

      {/* Chart de evolución de impactos (Tiro FBI) */}
      {hasHits && (
        <Card className="px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
            Evolución de impactos
          </p>
          <PerformanceChart points={stats.timeline} mode="hits" />
        </Card>
      )}

      {stats.byDiscipline.length > 1 && (
        <Card className="px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
            Por disciplina
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
                    {d.count} torneo{d.count === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="text-right text-xs">
                  <p className="font-mono text-fg">
                    {formatPercent(d.avgPercentage)}
                  </p>
                  <p className="text-fg-subtle">
                    máx {formatPercent(d.bestPercentage)}
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
}: {
  avg: number | null;
  best: ShooterStats["bestPercentile"];
}) {
  if (avg === null) {
    return (
      <KpiCard
        label="Percentil promedio"
        value="—"
        hint="Sin datos de tamaño de división"
      />
    );
  }
  return (
    <KpiCard
      label="Percentil promedio"
      value={`Top ${avg.toFixed(0)}%`}
      hint={
        best ? (
          <Link
            href={`/matches/${best.matchId}/me`}
            className="hover:text-accent"
            title={best.matchName}
          >
            mejor: top {best.value.toFixed(0)}% ({formatDate(best.date)})
          </Link>
        ) : (
          "menor = mejor"
        )
      }
    />
  );
}

function ConsistencyCard({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <KpiCard
        label="Consistencia"
        value="—"
        hint="Necesitás al menos 2 torneos"
      />
    );
  }
  // Convención: <10 sólido, 10-20 normal, >20 volátil.
  const tag = value < 10 ? "sólido" : value < 20 ? "normal" : "volátil";
  return (
    <KpiCard
      label="Consistencia"
      value={`±${value.toFixed(1)}%`}
      hint={`${tag} · menor = más predecible`}
    />
  );
}

function ConsistencyHitsCard({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <KpiCard
        label="Consistencia impactos"
        value="—"
        hint="Necesitás al menos 2 torneos FBI"
      />
    );
  }
  // FBI: 40 impactos máx. Umbrales: <2 sólido, 2-5 normal, >5 volátil.
  const tag = value < 2 ? "sólido" : value < 5 ? "normal" : "volátil";
  return (
    <KpiCard
      label="Consistencia impactos"
      value={`±${value.toFixed(1)}`}
      hint={`${tag} · menor = más predecible`}
    />
  );
}

function SlopeCard({ slope }: { slope: number | null }) {
  if (slope === null) {
    return (
      <KpiCard
        label="Tendencia"
        value="—"
        hint="Necesitás al menos 2 torneos"
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
        Tendencia
      </p>
      <p
        className={cn(
          "mt-1.5 inline-flex items-center gap-1.5 font-mono text-2xl font-semibold tabular-nums",
          tone,
        )}
      >
        <Icon className="h-5 w-5" aria-hidden />
        {isFlat ? "Estable" : `${sign}${slope.toFixed(1)}%`}
      </p>
      <p className="mt-1 text-xs text-fg-subtle">
        {isFlat ? "regresión lineal sobre tu historial" : "% por torneo (regresión lineal)"}
      </p>
    </Card>
  );
}

function SlopeHitsCard({ slope }: { slope: number | null }) {
  if (slope === null) {
    return (
      <KpiCard
        label="Tendencia impactos"
        value="—"
        hint="Necesitás al menos 2 torneos FBI"
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
        Tendencia impactos
      </p>
      <p
        className={cn(
          "mt-1.5 inline-flex items-center gap-1.5 font-mono text-2xl font-semibold tabular-nums",
          tone,
        )}
      >
        <Icon className="h-5 w-5" aria-hidden />
        {isFlat ? "Estable" : `${sign}${slope.toFixed(1)}`}
      </p>
      <p className="mt-1 text-xs text-fg-subtle">
        {isFlat
          ? "regresión lineal sobre tu historial"
          : "impactos por torneo (regresión lineal)"}
      </p>
    </Card>
  );
}

function PenaltyRateCard({ rate }: { rate: number | null }) {
  if (rate === null) {
    return (
      <KpiCard
        label="Tasa de penalties"
        value="—"
        hint="no aplica a esta disciplina"
      />
    );
  }
  // Convención: <10% bajo, 10-25% normal, >25% alto.
  const tag = rate < 10 ? "bajo" : rate < 25 ? "normal" : "alto";
  return (
    <KpiCard
      label="Tasa de penalties"
      value={`${rate.toFixed(0)}%`}
      hint={`${tag} · stages con penalties`}
    />
  );
}

function CadenceCard({ cadence }: { cadence: CadenceStats | null }) {
  if (!cadence) {
    return <KpiCard label="Cadencia" value="—" hint="Sin matches" />;
  }
  const days = cadence.daysSinceLastMatch;
  const lastLabel =
    days === null
      ? null
      : days === 0
        ? "hoy"
        : days === 1
          ? "ayer"
          : days < 14
            ? `hace ${days} días`
            : days < 60
              ? `hace ${Math.round(days / 7)} sem`
              : `hace ${Math.round(days / 30)} meses`;

  return (
    <KpiCard
      label="Cadencia"
      value={`${cadence.matchesPerMonth.toFixed(1)}/mes`}
      hint={
        lastLabel
          ? `últ. 90d · último match ${lastLabel}`
          : "últimos 90 días"
      }
    />
  );
}
