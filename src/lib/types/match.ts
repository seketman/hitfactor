/**
 * Tipos de dominio para resultados de torneos.
 * Independientes de la base de datos: representan la salida del parser
 * y la entrada al importador.
 */

import type { DisciplineCode } from "@/lib/disciplines";

export type Discipline = DisciplineCode;

export type PowerFactor = "Min" | "Maj" | null;

export type ParsedMatchSource =
  | "practiscore_match_html"
  | "practiscore_combined_html"
  | "practiscore_stage_html"
  | "practiscore_steel_html"
  | "practiscore_pdf"
  | "fbi_csv";

/**
 * Identidad de un tirador tal como aparece en un reporte.
 * No es la entidad persistida: es lo que el parser extrae.
 * El importador resolverá esto contra la tabla `shooters`.
 */
export interface ParsedShooter {
  fullName: string;
  memberNumber: string | null;
  region: string | null;
}

/**
 * Resultado de un tirador en el match completo (no por stage).
 */
export interface ParsedMatchEntry {
  shooter: ParsedShooter;
  divisionCode: string;
  classification: string | null;
  powerFactor: PowerFactor;
  category: string | null;
  place: number;
  matchPoints: number;
  matchPercentage: number;
  /** Tiempo total para disciplinas time-based (Steel Challenge). NULL para IPSC. */
  totalTimeSeconds: number | null;
  isDq: boolean;
}

/**
 * Resultado de un tirador en un stage (Tiro Práctico).
 */
export interface ParsedStageResult {
  shooter: ParsedShooter;
  divisionCode: string;
  classification: string | null;
  powerFactor: PowerFactor;
  points: number | null;
  penalties: number | null;
  timeSeconds: number | null;
  hitFactor: number | null;
  stagePoints: number;
  stagePercentage: number;
  place: number;
  isDq: boolean;
}

export interface ParsedStage {
  stageNumber: number | null;
  name: string;
  results: ParsedStageResult[];
}

/**
 * Resultado completo de un parseo de un archivo HTML.
 * Un archivo puede contener:
 *  - Match results combinados (todas las divisiones)
 *  - Match results por división (varias secciones)
 *  - Resultados de un único stage (con secciones por división)
 */
export interface ParsedMatch {
  discipline: Discipline;
  source: ParsedMatchSource;
  /** Nombre tal como aparece en el reporte */
  name: string;
  /** Fecha del match en formato ISO (YYYY-MM-DD) */
  date: string;
  /** Región/club si está identificable, ej "ARG-TFALP" */
  region: string | null;
  /** Resultados generales del match (vacío si el archivo es de un stage) */
  matchEntries: ParsedMatchEntry[];
  /** Stages parseados (vacío si el archivo es solo de match results) */
  stages: ParsedStage[];
  /** Texto del pie de página (PractiScore version, etc.) */
  generatedBy: string | null;
}
