"use client";

import { useId, useState } from "react";
import { cn, formatDate, formatPercent } from "@/lib/utils";
import type { MatchTimelinePoint } from "@/lib/stats/shooter-stats";

/**
 * Line chart en SVG puro (sin libs) que muestra la evolución temporal de
 * una métrica del tirador a lo largo de los torneos.
 *
 * Modos:
 *  - `"percentage"` (default): grafica `matchPercentage`. Eje Y de 0 a 100+
 *    con grid en 0/25/50/75/100. DQs en y=0.
 *  - `"hits"`: grafica `hits` (Tiro FBI). Eje Y de 0 a 40 con grid en
 *    0/10/20/30/40. Filtra puntos sin hits (otras disciplinas).
 *
 * Comportamiento común:
 *  - Eje X: orden cronológico (los gaps de fecha se "comprimen" para que la
 *    línea sea legible aun cuando hay períodos sin matches).
 *  - DQs se dibujan como puntos rojos sobre y=0.
 *  - Hover muestra tooltip con detalle.
 */

type Mode = "percentage" | "hits";

interface PerformanceChartProps {
  points: MatchTimelinePoint[];
  mode?: Mode;
}

export function PerformanceChart({ points, mode = "percentage" }: PerformanceChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const gradientId = useId();

  // Para "hits", excluimos puntos sin hits (matches de IPSC/Steel cuando el
  // dashboard es consolidado). Si no quedan al menos 2 puntos, no graficamos.
  const filteredPoints =
    mode === "hits" ? points.filter((p) => p.hits !== null) : points;

  if (filteredPoints.length < 2) return null;

  const W = 600;
  const H = 180;
  const PAD_L = 36;
  const PAD_R = 12;
  const PAD_T = 16;
  const PAD_B = 28;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  // Accessor del valor para cada modo.
  const valueOf = (p: MatchTimelinePoint): number =>
    mode === "hits" ? (p.hits ?? 0) : p.matchPercentage;

  const formatValue = (v: number) =>
    mode === "hits" ? String(Math.round(v)) : formatPercent(v);

  const yMax =
    mode === "hits"
      ? 40 // FBI: 8 stages × 5 disparos = 40 impactos máximo.
      : Math.max(
          100,
          ...filteredPoints.filter((p) => !p.isDq).map((p) => p.matchPercentage),
        );
  const yMin = 0;

  const gridYs =
    mode === "hits"
      ? [0, 10, 20, 30, 40]
      : [0, 25, 50, 75, 100].filter((v) => v <= yMax);

  const xFor = (i: number) =>
    PAD_L +
    (filteredPoints.length === 1
      ? innerW / 2
      : (i / (filteredPoints.length - 1)) * innerW);
  const yFor = (v: number) =>
    PAD_T + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  // Línea solo con los no-DQ (los DQ se muestran como puntos sueltos).
  const linePoints = filteredPoints
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !p.isDq);

  const pathD = linePoints
    .map(({ p, i }, idx) => {
      const x = xFor(i);
      const y = yFor(valueOf(p));
      return `${idx === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const areaD = linePoints.length
    ? `${pathD} L${xFor(linePoints[linePoints.length - 1]!.i).toFixed(1)},${yFor(0).toFixed(1)} L${xFor(linePoints[0]!.i).toFixed(1)},${yFor(0).toFixed(1)} Z`
    : "";

  // Para los X labels mostramos máximo ~5 puntos para no saturar.
  const xLabelStep = Math.max(1, Math.ceil(filteredPoints.length / 5));

  const ariaLabel =
    mode === "hits"
      ? "Evolución de impactos"
      : "Evolución del match percentage";

  return (
    <div className="mt-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-44 w-full"
        role="img"
        aria-label={ariaLabel}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid horizontal */}
        {gridYs.map((v) => (
          <g key={v}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={yFor(v)}
              y2={yFor(v)}
              stroke="var(--border)"
              strokeDasharray="2,3"
              strokeWidth={1}
            />
            <text
              x={PAD_L - 6}
              y={yFor(v)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-fg-subtle"
              fontSize={10}
            >
              {v}
            </text>
          </g>
        ))}

        {/* Área bajo la curva */}
        {areaD && <path d={areaD} fill={`url(#${gradientId})`} />}

        {/* Línea */}
        {pathD && (
          <path
            d={pathD}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1.75}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* Puntos */}
        {filteredPoints.map((p, i) => {
          const cx = xFor(i);
          const cy = p.isDq ? yFor(0) : yFor(valueOf(p));
          const isHover = hover === i;
          return (
            <g key={p.matchId + i}>
              <circle
                cx={cx}
                cy={cy}
                r={isHover ? 4.5 : 3}
                className={cn(
                  "transition-all",
                  p.isDq ? "fill-danger" : "fill-accent",
                )}
                stroke="var(--surface)"
                strokeWidth={1.5}
              />
              {/* Hit area más grande para hover */}
              <circle
                cx={cx}
                cy={cy}
                r={12}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`${p.matchName}: ${p.isDq ? "DQ" : formatValue(valueOf(p))}`}
              />
            </g>
          );
        })}

        {/* X labels */}
        {filteredPoints.map((p, i) => {
          if (i % xLabelStep !== 0 && i !== filteredPoints.length - 1) return null;
          return (
            <text
              key={`xl-${i}`}
              x={xFor(i)}
              y={H - 8}
              textAnchor="middle"
              className="fill-fg-subtle"
              fontSize={10}
            >
              {p.date.slice(5)}
            </text>
          );
        })}
      </svg>

      {hover !== null && filteredPoints[hover] && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs">
          <span className="font-medium">{filteredPoints[hover].matchName}</span>
          <span className="text-fg-muted">
            {formatDate(filteredPoints[hover].date)}
          </span>
          <span className="text-fg-muted">
            {filteredPoints[hover].divisionCode}
          </span>
          <span className="ml-auto font-mono">
            {filteredPoints[hover].isDq
              ? "DQ"
              : formatValue(valueOf(filteredPoints[hover]))}
            {!filteredPoints[hover].isDq && (
              <span className="ml-2 text-fg-subtle">
                puesto #{filteredPoints[hover].place}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
