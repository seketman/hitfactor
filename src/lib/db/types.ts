/**
 * Tipos de DB compartidos. Hasta que generemos types con `supabase gen types`,
 * los definimos manualmente acá. Solo lo que necesitan las páginas.
 */

export interface Profile {
  id: string;
  display_name: string;
  full_name: string | null;
  member_number: string | null;
}

export interface Discipline {
  id: number;
  code: string;
  name: string;
  scoring_type: string;
}

export interface Division {
  id: number;
  discipline_id: number;
  code: string;
  name: string;
}

export interface Shooter {
  id: string;
  full_name: string;
  member_number: string | null;
  region: string | null;
  linked_user_id: string | null;
}

export interface Match {
  id: string;
  name: string;
  date: string;
  region: string | null;
  imported_at: string;
  imported_by_user_id: string;
  source_filename: string | null;
}

export interface MatchWithDiscipline extends Match {
  disciplines: { code: string; name: string; scoring_type?: string } | null;
}

export interface Stage {
  id: string;
  match_id: string;
  stage_number: number | null;
  name: string;
  max_points: number | null;
}

export interface MatchEntry {
  id: string;
  match_id: string;
  shooter_id: string;
  division_id: number;
  classification: string | null;
  power_factor: "Min" | "Maj" | null;
  category: string | null;
  place: number;
  match_points: number;
  match_percentage: number;
  total_time_seconds: number | null;
  /** Impactos (sólo Tiro FBI: 0..40 — ranking primario). NULL en IPSC/Steel. */
  hits: number | null;
  is_dq: boolean;
}

export interface MatchEntryWithRelations extends MatchEntry {
  divisions: { code: string; name: string } | null;
  shooters: Shooter | null;
}

export interface MyEntryRow {
  id: string;
  place: number;
  match_points: number;
  match_percentage: number;
  total_time_seconds: number | null;
  /** Impactos (Tiro FBI). NULL en disciplinas no hits-based. */
  hits: number | null;
  is_dq: boolean;
  power_factor: "Min" | "Maj" | null;
  category: string | null;
  divisions: { code: string; name: string } | null;
  matches: {
    id: string;
    name: string;
    date: string;
    region: string | null;
    disciplines: { code: string; name: string; scoring_type?: string } | null;
  } | null;
}

/** Mi resultado en un stage individual con la info del stage embebida. */
export interface MyStageResultRow {
  id: string;
  points: number | null;
  penalties: number | null;
  time_seconds: number | null;
  hit_factor: number | null;
  stage_points: number;
  stage_percentage: number;
  place: number | null;
  /** Impactos del stage (Tiro FBI: 0..5). NULL en IPSC/Steel. */
  hits: number | null;
  is_dq: boolean;
  stages: {
    id: string;
    stage_number: number | null;
    name: string;
  } | null;
}

export interface AuditLogRow {
  id: number;
  user_id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export type FeedbackType = "bug" | "suggestion" | "other";
export type FeedbackStatus =
  | "new"
  | "triaged"
  | "in_progress"
  | "done"
  | "wontdo"
  | "duplicate";

export interface FeedbackRow {
  id: number;
  user_id: string;
  type: FeedbackType;
  message: string;
  page_url: string | null;
  status: FeedbackStatus;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface Club {
  code: string;
  name: string;
  country: string | null;
}

export interface Firearm {
  id: string;
  owner_user_id: string;
  name: string;
  brand: string | null;
  model: string | null;
  caliber: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MatchFirearmLog {
  match_entry_id: string;
  firearm_id: string;
  rounds_fired: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Estadísticas de uso de un arma a partir del log. */
export interface FirearmUsageStats {
  firearm: Firearm;
  totalMatches: number;
  totalRounds: number;
  /** Fecha del último match (YYYY-MM-DD), o null si no se usó nunca. */
  lastUsedDate: string | null;
}

/** Resumen de mi participación en un match: entry + stages. */
export interface MyMatchSummary {
  match: MatchWithDiscipline;
  entry: {
    id: string;
    place: number;
    match_points: number;
    match_percentage: number;
    total_time_seconds: number | null;
    /** Impactos del match (Tiro FBI). NULL en otras disciplinas. */
    hits: number | null;
    is_dq: boolean;
    power_factor: "Min" | "Maj" | null;
    category: string | null;
    classification: string | null;
    divisions: { code: string; name: string } | null;
  };
  stageResults: MyStageResultRow[];
}
