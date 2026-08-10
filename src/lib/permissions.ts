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
 *
 * ## Lo que un admin puede hacer, y dónde está escrito
 *
 * `profiles.is_admin` habilita tres cosas, y solo dos viven en este
 * archivo:
 *
 *  1. Editar cualquier match (`canEditMatch`) — RLS `matches_update_admin`.
 *  2. Borrar cualquier match (`canDeleteMatch`) — RLS `matches_delete_admin`.
 *  3. **Ver el dashboard de otro usuario** vía `?asProfile=<uuid>`.
 *
 * La tercera no tiene predicado acá porque no espeja ninguna RLS: no
 * concede permisos de DB, usa la sesión del admin —que ya puede leer esas
 * filas— y solo cambia qué shooters mira el dashboard. Se menciona igual
 * porque estaba documentada en ningún lado (#208), y "las capacidades de
 * admin están en permissions.ts" deja de ser cierto en cuanto una queda
 * afuera sin decirlo.
 *
 * Vive en `lib/admin/impersonation.ts`, que es donde están el gate, la
 * carga y el registro en `audit_log`. Es de solo lectura: la sesión sigue
 * siendo la del admin y toda escritura se le atribuye a él.
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
 * `true` if the user may edit the match (club, min_shots).
 * Mirrors: the match importer, or a site admin.
 *
 * RLS: `matches_update_importer` (0001) + `matches_update_admin` (0014).
 */
export function canEditMatch(ctx: MatchEditContext): boolean {
  return ctx.isAdmin || ctx.importedByUserId === ctx.userId;
}

/**
 * `true` if the user may DELETE the match.
 *
 * Today this is the same rule as `canEditMatch`, and it still gets its own
 * function: deleting has its own policies (`matches_delete_importer` in
 * 0001 + `matches_delete_admin` in 0022), and a call site reading
 * `canDeleteMatch` before a delete doesn't require remembering that "edit"
 * also covered deletion. If the admin scope ever diverges, it diverges
 * here instead of sending someone hunting for which `canEditMatch` was
 * really a delete.
 *
 * Deleting cascades to `match_entries`, `stages` and `stage_results`; it
 * does not touch `shooters` or `firearms`.
 */
export function canDeleteMatch(ctx: MatchEditContext): boolean {
  return canEditMatch(ctx);
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
