import type { TypedSupabaseClient } from "../supabase/types";
import type { Json } from "../supabase/database.types";

/**
 * Códigos canónicos de acciones registrables en `audit_log`.
 *
 * Convención: `<entidad>.<verbo>`. Si agregás una acción nueva, sumala
 * acá Y en `describeAuditEntry` para que la pantalla `/activity` la
 * muestre legible.
 */
export const AUDIT_ACTION = {
  MATCH_IMPORT: "match.import",
  MATCH_DELETE: "match.delete",
  MATCH_UPDATE_CLUB: "match.update_club",
  SHOOTER_CLAIM: "shooter.claim",
  SHOOTER_UNCLAIM: "shooter.unclaim",
  FIREARM_CREATE: "firearm.create",
  FIREARM_UPDATE: "firearm.update",
  FIREARM_DELETE: "firearm.delete",
  MATCH_FIREARM_SET: "match_firearm.set",
  MATCH_FIREARM_CLEAR: "match_firearm.clear",
  ENTRY_UPDATE_ABSENT: "entry.update_absent",
} as const;

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

interface LogActionInput {
  /** Acción canónica (usar las constantes de `AUDIT_ACTION`). */
  action: AuditAction;
  /** Tipo de entidad afectada (ej: "match", "firearm", "shooter"). */
  entityType?: string;
  /** Id de la entidad afectada — UUID o id stringificado. */
  entityId?: string;
  /** Datos adicionales para reconstruir el contexto (snapshots before/after, nombres, etc.). */
  metadata?: Json;
}

/**
 * Registra una acción del usuario en `audit_log`.
 *
 * **Best-effort**: si el insert falla, loggeamos un warning pero no
 * propagamos el error — la acción del usuario nunca debe romperse por
 * un fallo de auditoría. Se loguea con `console.warn` para que en dev
 * sea visible.
 *
 * Asume que `supabase` está autenticado como el usuario actual; la RLS
 * exige `auth.uid() = user_id`.
 */
export async function logAction(
  supabase: TypedSupabaseClient,
  userId: string,
  input: LogActionInput,
): Promise<void> {
  const { error } = await supabase.from("audit_log").insert({
    user_id: userId,
    action: input.action,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    metadata: input.metadata ?? null,
  });

  if (error) {
    console.warn(
      `[audit] failed to log "${input.action}" for user ${userId}: ${error.message}`,
    );
  }
}
