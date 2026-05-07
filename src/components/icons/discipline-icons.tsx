import type { SVGProps } from "react";
import { Target } from "lucide-react";
import { DISCIPLINE } from "@/lib/disciplines";

/**
 * Iconos custom por disciplina, basados en sus blancos típicos:
 *
 *  - **IPSC** (Tiro Práctico): silueta tipo Bruselas (cabeza + torso).
 *  - **FBI**: bullseye con anillos concéntricos.
 *  - **Steel Challenge**: 4 platos redondos + 1 stop plate.
 *
 * Diseño consistente con lucide-react: viewBox 24×24, stroke currentColor,
 * stroke-width 1.75. Permite reemplazar los `<Target>` en el sidebar por
 * algo que se identifique al primer vistazo cuando el menú está colapsado.
 */

const SVG_DEFAULTS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IpscIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" {...SVG_DEFAULTS} {...props}>
      {/* Cabeza */}
      <rect x="9.5" y="3" width="5" height="4" rx="0.5" />
      {/* Torso (trapecio: hombros más anchos que cintura) */}
      <path d="M5 9 H19 L17 21 H7 Z" />
    </svg>
  );
}

export function FbiIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" {...SVG_DEFAULTS} {...props}>
      <circle cx="12" cy="12" r="9.25" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="3" />
      {/* Punto central */}
      <circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SteelIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" {...SVG_DEFAULTS} {...props}>
      {/* 4 platos redondos */}
      <circle cx="6" cy="6" r="2.25" />
      <circle cx="18" cy="6" r="2.25" />
      <circle cx="6" cy="18" r="2.25" />
      <circle cx="12" cy="12" r="2.25" />
      {/* Stop plate (rectangular) */}
      <rect x="14.5" y="14.5" width="5.5" height="5.5" rx="0.5" />
    </svg>
  );
}

/**
 * Devuelve el componente de ícono correspondiente al code de disciplina.
 * Fallback a `Target` (lucide) para disciplinas sin ícono custom.
 */
export function getDisciplineIcon(code: string) {
  switch (code) {
    case DISCIPLINE.IPSC:
      return IpscIcon;
    case DISCIPLINE.FBI:
      return FbiIcon;
    case DISCIPLINE.STEEL:
      return SteelIcon;
    default:
      return Target;
  }
}
