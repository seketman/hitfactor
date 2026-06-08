/**
 * Códigos canónicos de disciplinas y helpers asociados.
 *
 * Single source of truth: tienen que coincidir 1:1 con la columna
 * `disciplines.code` en la DB (ver supabase/migrations/0001_initial_schema.sql).
 *
 * Si agregás una disciplina nueva:
 *   1. Insertala en la migración correspondiente.
 *   2. Agregala acá con su code.
 *   3. Si puntúa por tiempo en lugar de hit factor / puntos, sumala a TIME_BASED.
 */

export const DISCIPLINE = {
  IPSC: "ipsc",
  STEEL: "steel_challenge",
  COMBAT: "combat_solutions",
  FBI: "tiro_fbi",
} as const;

export type DisciplineCode = (typeof DISCIPLINE)[keyof typeof DISCIPLINE];

const TIME_BASED: Set<string> = new Set([DISCIPLINE.STEEL, DISCIPLINE.COMBAT]);

const HITS_BASED: Set<string> = new Set([DISCIPLINE.FBI]);

// Disciplinas cuyo scoring contempla penalties por stage (mike, no-shoot,
// procedural en IPSC; time-plus penalties en Combat Solutions). Steel y
// FBI no usan el concepto de penalty per-stage.
const PENALTY_TRACKING: Set<string> = new Set([
  DISCIPLINE.IPSC,
  DISCIPLINE.COMBAT,
]);

/**
 * True si la disciplina puntúa por tiempo total (Steel Challenge / Combat
 * Solutions). Acepta el code suelto, o el objeto `disciplines` embebido que
 * devuelven las queries de match (con `code` y/o `scoring_type`).
 *
 * Prefiere `scoring_type === "time_plus"` cuando viene seteado — así una
 * disciplina nueva con ese scoring_type queda detectada sin tocar este archivo.
 */
export function isTimeBasedDiscipline(
  input:
    | string
    | { code?: string | null; scoring_type?: string | null }
    | null
    | undefined,
): boolean {
  if (input == null) return false;
  if (typeof input === "string") return TIME_BASED.has(input);
  if (input.scoring_type === "time_plus") return true;
  if (input.code && TIME_BASED.has(input.code)) return true;
  return false;
}

/**
 * True si la disciplina rankea primariamente por cantidad de impactos
 * (Tiro FBI). En estas disciplinas el campo `hits` de un entry/result es
 * el criterio primario y el puntaje funciona como desempate.
 */
export function isHitsBasedDiscipline(
  input:
    | string
    | { code?: string | null }
    | null
    | undefined,
): boolean {
  if (input == null) return false;
  const code = typeof input === "string" ? input : input.code;
  return !!code && HITS_BASED.has(code);
}

/**
 * True si la disciplina trackea penalties por stage en su scoring (IPSC,
 * Combat Solutions). Sirve para que la UI distinga "no aplica a esta
 * disciplina" (FBI/Steel) de "sin datos de penalties en el historial"
 * (IPSC/Combat pero el archivo importado no traía la columna cargada).
 */
export function isPenaltyTrackingDiscipline(
  input:
    | string
    | { code?: string | null }
    | null
    | undefined,
): boolean {
  if (input == null) return false;
  const code = typeof input === "string" ? input : input.code;
  return !!code && PENALTY_TRACKING.has(code);
}
