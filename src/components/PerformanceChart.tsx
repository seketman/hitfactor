"use client";

import { useId, useState } from "react";
import { cn, formatDate, formatPercent } from "@/lib/utils";
import type { MatchTimelinePoint } from "@/lib/stats/shooter-stats";

/**
 * Line chart en SVG puro (sin libs) que muestra la evolución del Match %
 * a lo largo de los torneos. Hover muestra tooltip con detalle.
 *
 * - Eje X: orden cronológico (los gaps de fecha se "comprimen" para que la
 *   línea sea legible aun cuando hay períodos sin matches).
 * - Eje Y: 0 a max(100, mejor%) con margen.
 * - Los DQ se dibujan como puntos rojos en y=0.
 */
export function PerformanceChart({
  points,
}: {
  points: MatchTimelinePoint[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const gradientId = useId();

  if (points.length < 2) return null;

  const W = 600;
  const H = 180;
  const PAD_L = 36;
  const PAD_R = 12;
  const PAD_T = 16;
  const PAD_B = 28;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const yMax = Math.max(
    100,
    ...points.filter((p) => !p.isDq).map((p) => p.matchPercentage),
  );
  const yMin = 0;

  const xFor = (i: number) =>
    PAD_L + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const yFor = (v: number) =>
    PAD_T + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  // Línea solo con los no-DQ (los DQ se muestran como puntos sueltos).
  const linePoints = points
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !p.isDq);

  const pathD = linePoints
    .map(({ p, i }, idx) => {
      const x = xFor(i);
      const y = yFor(p.matchPercentage);
      return `${idx === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const areaD = linePoints.length
    ? `${pathD} L${xFor(linePoints[linePoints.length - 1]!.i).toFixed(1)},${yFor(0).toFixed(1)} L${xFor(linePoints[0]!.i).toFixed(1)},${yFor(0).toFixed(1)} Z`
    : "";

  const gridYs = [0, 25, 50, 75, 100].filter((v) => v <= yMax);

  // Para los X labels mostramos máximo ~5 puntos para no saturar.
  const xLabelStep = Math.max(1, Math.ceil(points.length / 5));

  return (
    <div className="mt-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-44 w-full"
        role="img"
        aria-label="Evolución del match percentage"
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
        {points.map((p, i) => {
          const cx = xFor(i);
          const cy = p.isDq ? yFor(0) : yFor(p.matchPercentage);
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
                aria-label={`${p.matchName}: ${p.isDq ? "DQ" : formatPercent(p.matchPercentage)}`}
              />
            </g>
          );
        })}

        {/* X labels */}
        {points.map((p, i) => {
          if (i % xLabelStep !== 0 && i !== points.length - 1) return null;
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

      {hover !== null && points[hover] && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs">
          <span className="font-medium">{points[hover].matchName}</span>
          <span className="text-fg-muted">
            {formatDate(points[hover].date)}
          </span>
          <span className="text-fg-muted">
            {points[hover].divisionCode}
          </span>
          <span className="ml-auto font-mono">
            {points[hover].isDq
              ? "DQ"
              : formatPercent(points[hover].matchPercentage)}
            {!points[hover].isDq && (
              <span className="ml-2 text-fg-subtle">
                puesto #{points[hover].place}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
