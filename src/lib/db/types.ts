/**
 * Tipos de dominio compartidos por las páginas y componentes.
 *
 * No son los tipos crudos de la DB — esos se generan con `npm run db:types`
 * en `../supabase/database.types.ts` y los usa el cliente Supabase tipado
 * (`TypedSupabaseClient`). Acá vivimos los tipos "de app": shapes de selects
 * con joins embebidos y narrowings que la DB no expresa (ej. `power_factor`
 * es `text` en la DB pero el parser garantiza `"Min" | "Maj" | null`).
 */

export interface Profile {
  id: string;
  display_name: string;
  full_name: string | null;
  member_number: string | null;
  /**
   * Administrador del sitio. Bootstrap manual vía SQL (UPDATE profiles).
   * Habilita vistas de diagnóstico como "ver el dashboard como otro tirador".
   */
  is_admin: boolean;
}

/**
 * Preferencias de UI persistidas en `profiles.ui_prefs` (jsonb).
 * Forma libre — agregamos campos sin migration. Las keys que no entiende
 * el cliente se ignoran. Todos los campos son opcionales: si el usuario
 * nunca tocó la preferencia, no aparece y el cliente cae al default.
 */
export interface UiPrefs {
  /** Items por página en el listado `/matches`. */
  matchesPageSize?: number;
  /**
   * Si true, ocultamos las sugerencias de "Soy yo" del listado de matches.
   * Sirve para usuarios que ya entendieron el modelo y prefieren la vista
   * limpia, o que no quieren claimar ninguno de los candidatos sugeridos.
   * Una vez que el usuario claima cualquier shooter, las sugerencias dejan
   * de mostrarse igual (el gate primario es `myShooters.length === 0`).
   */
  claimSuggestionsDismissed?: boolean;
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
  /**
   * Tirador anotado pero no asistió (0 puntos, 0%). Excluido de KPIs igual
   * que `is_dq`, pero el badge UI es neutro (no señala una infracción).
   */
  is_absent: boolean;
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
  is_absent: boolean;
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

/**
 * Fila liviana de stage_results del usuario para agregación cross-matches.
 * No incluye joins — solo los campos necesarios para computar KPIs.
 */
export interface MyStageRow {
  place: number | null;
  penalties: number | null;
  stage_percentage: number;
  is_dq: boolean;
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
  /**
   * Zona geográfica FATP (Atlántica, Centro, Cuyo, Litoral, Metropolitana,
   * Noreste, Noroeste, Patagónica). Nullable: clubes fuera del esquema
   * FATP (extranjeros, etc.) pueden quedar sin zona.
   */
  zone: string | null;
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
  /**
   * Tipo de munición usado en este match. Null = no especificado.
   * ON DELETE SET NULL: borrar el tipo no destruye el historial.
   */
  ammunition_type_id: string | null;
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

/**
 * Tipo de munición del catálogo del tirador. Cubre factory (compradas)
 * y reload (recargadas). Los campos opcionales se completan en función
 * de cuánto detalle quiera registrar el tirador — solo `name` y `type`
 * son obligatorios a nivel schema.
 */
export interface AmmunitionType {
  id: string;
  owner_user_id: string;
  name: string;
  type: "factory" | "reload";
  caliber: string | null;
  brand: string | null;
  /** Peso de la punta en grains (1 grain ≈ 64.8 mg). */
  bullet_weight_grains: number | null;
  /** FMJ, HP, JSP, etc. — texto libre. */
  bullet_type: string | null;
  /** Solo relevante para type=reload. */
  powder: string | null;
  /** Carga de pólvora en grains. Solo relevante para type=reload. */
  powder_charge_grains: number | null;
  /** Factor declarado (no calculado). */
  power_factor: "Min" | "Maj" | null;
  /**
   * Power factor medido en cronógrafo (peso × velocidad / 1000).
   * Independiente del campo categórico `power_factor` — un tirador puede
   * haber medido el valor exacto sin haberse clasificado todavía.
   */
  power_factor_measured: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Estadísticas de uso de un tipo de munición a partir del log. */
export interface AmmunitionUsageStats {
  ammo: AmmunitionType;
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
    is_absent: boolean;
    power_factor: "Min" | "Maj" | null;
    category: string | null;
    classification: string | null;
    divisions: { code: string; name: string } | null;
  };
  stageResults: MyStageResultRow[];
}
