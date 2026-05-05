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
  disciplines: { name: string } | null;
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
  is_dq: boolean;
  power_factor: "Min" | "Maj" | null;
  category: string | null;
  divisions: { code: string; name: string } | null;
  matches: { id: string; name: string; date: string; region: string | null } | null;
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
  is_dq: boolean;
  stages: {
    id: string;
    stage_number: number | null;
    name: string;
  } | null;
}

/** Resumen de mi participación en un match: entry + stages. */
export interface MyMatchSummary {
  match: MatchWithDiscipline;
  entry: {
    id: string;
    place: number;
    match_points: number;
    match_percentage: number;
    is_dq: boolean;
    power_factor: "Min" | "Maj" | null;
    category: string | null;
    classification: string | null;
    divisions: { code: string; name: string } | null;
  };
  stageResults: MyStageResultRow[];
}
