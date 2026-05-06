import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { PerformanceChart } from "@/components/PerformanceChart";
import { cn, formatPercent, formatDate } from "@/lib/utils";
import type { CadenceStats, ShooterStats } from "@/lib/stats/shooter-stats";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

/**
 * Bloque de KPIs + chart para el historial del tirador.
 * Se renderiza solo si hay al menos un torneo válido (no DQ).
 */
export function StatsOverview({ stats }: { stats: ShooterStats }) {
  if (stats.scoredMatches === 0) return null;

  return (
    <div className="space-y-4">
      {/* Fila 1: rendimiento crudo */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Torneos disputados"
          value={String(stats.totalMatches)}
          hint={
            stats.totalMatches !== stats.scoredMatches
              ? `${stats.scoredMatches} válidos · ${stats.totalMatches - stats.scoredMatches} DQ`
              : undefined
          }
        />
        <KpiCard
          label="Promedio %"
          value={formatPercent(stats.avgPercentage)}
          hint={
            stats.topDivision ? `Top div: ${stats.topDivision.code}` : undefined
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

      {/* Fila 2: KPIs derivados (estado actual + proyección) */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PercentileCard
          avg={stats.avgPercentile}
          best={stats.bestPercentile}
        />
        <ConsistencyCard value={stats.consistency} />
        <SlopeCard slope={stats.trajectorySlope} />
        <CadenceCard cadence={stats.cadence} />
      </div>

      {/* Chart */}
      <Card className="px-5 py-4">
        <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
          Evolución
        </p>
        {stats.timeline.length >= 2 ? (
          <PerformanceChart points={stats.timeline} />
        ) : (
          <p className="mt-3 text-sm text-fg-subtle">
            Necesitás al menos 2 torneos para ver la evolución.
          </p>
        )}
      </Card>

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
  const tag =
    value < 10 ? "sólido" : value < 20 ? "normal" : "volátil";
  return (
    <KpiCard
      label="Consistencia"
      value={`±${value.toFixed(1)}%`}
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
