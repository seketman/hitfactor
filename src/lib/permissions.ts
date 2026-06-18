/**
 * Predicados de permiso de edición de matches/entries.
 *
 * Centralizan la regla "importador o admin (o el propio tirador)" que hoy
 * estaba re-derivada inline en server actions y en la página de detalle, y
 * que **debe espejar la RLS** (policies `matches_update_admin` — migración
 * 0014 — y `match_entries_update_*` — migración 0008). Tener la regla en un
 * solo lugar evita que UI, server action y RLS driften. Ver issue #115.
 *
 * Son funciones puras sobre primitivas: el caller resuelve cómo obtiene
 * `isAdmin` (de su `profile`) e `isSelf` (en una action, por
 * `shooter.linked_user_id === user.id`; en la página, por pertenencia al
 * set de shooters claimeados del usuario).
 */

export interface MatchEditContext {
  /** `auth.uid()` del usuario actual. */
  userId: string;
  /** `profiles.is_admin` del usuario actual. */
  isAdmin: boolean;
  /** `matches.imported_by_user_id` del match. */
  importedByUserId: string | null;
}

/**
 * `true` si el usuario puede editar el match (club, min_shots, delete).
 * Espeja: importador del match, o admin del sitio.
 */
export function canEditMatch(ctx: MatchEditContext): boolean {
  return ctx.isAdmin || ctx.importedByUserId === ctx.userId;
}

/**
 * `true` si el usuario puede editar un match_entry (ej. togglear `is_absent`).
 * Espeja la RLS ampliada en 0008: importador, admin, o el propio tirador
 * (el shooter del entry está linkeado a este usuario).
 */
export function canEditEntry(
  ctx: MatchEditContext & { isSelf: boolean },
): boolean {
  return canEditMatch(ctx) || ctx.isSelf;
}
