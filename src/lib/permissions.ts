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
 * `true` si el usuario puede editar el match (club, min_shots).
 * Espeja: importador del match, o admin del sitio.
 *
 * RLS: `matches_update_importer` (0001) + `matches_update_admin` (0014).
 */
export function canEditMatch(ctx: MatchEditContext): boolean {
  return ctx.isAdmin || ctx.importedByUserId === ctx.userId;
}

/**
 * `true` si el usuario puede BORRAR el match.
 *
 * Hoy es la misma regla que `canEditMatch`, y aun así vive en su propia
 * función: borrar tiene su propia policy (`matches_delete_importer` en la
 * 0001 + `matches_delete_admin` en la 0022), y un call-site que dice
 * `canDeleteMatch` antes de un delete se lee sin tener que recordar que
 * "editar" también incluía borrar. Si el alcance del admin se separa
 * alguna vez, se separa acá y no hay que ir a buscar cuál de los
 * `canEditMatch` era en realidad un delete.
 *
 * El borrado arrastra por cascade `match_entries`, `stages` y
 * `stage_results`; no toca `shooters` ni `firearms`.
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
