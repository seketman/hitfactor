import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PerformanceChart } from "@/components/PerformanceChart";
import { cn, formatPercent, formatDate } from "@/lib/utils";
import type { ShooterStats } from "@/lib/stats/shooter-stats";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

/**
 * Bloque de KPIs + chart para el historial del tirador.
 * Se renderiza solo si hay al menos un torneo válido (no DQ).
 */
export function StatsOverview({ stats }: { stats: ShooterStats }) {
  if (stats.scoredMatches === 0) return null;

  return (
    <div className="space-y-4">
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

      <div className="grid gap-3 lg:grid-cols-3">
        <TrendCard
          delta={stats.trendDelta}
          window={stats.trendWindow}
        />
        <Card className="px-5 py-4 lg:col-span-2">
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
      </div>

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

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
}) {
  return (
    <Card className="px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
        {label}
      </p>
      <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
        {value}
      </p>
      {hint && (
        <p className="mt-1 truncate text-xs text-fg-subtle">{hint}</p>
      )}
    </Card>
  );
}

function TrendCard({
  delta,
  window,
}: {
  delta: number | null;
  window: number;
}) {
  if (delta === null) {
    return (
      <Card className="px-5 py-4">
        <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
          Tendencia
        </p>
        <p className="mt-1.5 text-sm text-fg-subtle">
          Necesitás más torneos para calcular tu tendencia.
        </p>
      </Card>
    );
  }

  // Umbral pequeño para considerarla "estable" en lugar de mostrar ±0.x
  const ABS_THRESHOLD = 0.5;
  const isFlat = Math.abs(delta) < ABS_THRESHOLD;
  const isUp = !isFlat && delta > 0;
  const Icon = isFlat ? Minus : isUp ? TrendingUp : TrendingDown;
  const tone = isFlat
    ? "text-fg-muted"
    : isUp
      ? "text-success"
      : "text-danger";
  const sign = delta > 0 ? "+" : "";

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
        {isFlat ? "Estable" : `${sign}${delta.toFixed(1)}%`}
      </p>
      <p className="mt-1 text-xs text-fg-subtle">
        Últimos {window} vs anteriores {window}
        {" · "}
        <Badge>avg</Badge>
      </p>
    </Card>
  );
}
