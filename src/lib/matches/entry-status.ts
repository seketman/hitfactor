import { canEditEntry, type MatchEditContext } from "@/lib/permissions";

/**
 * Reglas de presentación/estado de un match_entry, extraídas del JSX de la
 * página de detalle para que sean testeables y compartidas entre la UI y el
 * server action (que deben coincidir entre sí y con la RLS). Ver issue #121.
 */

/** Subset de un entry necesario para estas reglas. */
export interface EntryStatusFields {
  is_dq: boolean;
  is_absent: boolean;
  match_points: number;
  match_percentage: number;
}

/**
 * `true` si el entry parece un ausente: todo en cero. No es lo mismo que
 * `is_absent` (la marca explícita) — es el heurístico para decidir si tiene
 * sentido *ofrecer* marcarlo ausente. Un entry con puntaje o % > 0 disparó al
 * menos un tiro y no puede ser ausente.
 */
export function isLikelyAbsent(entry: {
  match_points: number;
  match_percentage: number;
}): boolean {
  return entry.match_points === 0 && entry.match_percentage === 0;
}

/**
 * `true` si hay que mostrar el toggle "marcar ausente / sí asistió" sobre la
 * fila. Espeja la validación del server action `toggleEntryAbsent` y la RLS
 * 0008: solo entries no-DQ que ya están ausentes o están en cero, y solo si
 * el usuario puede editar el entry (importador, admin o el propio tirador).
 */
export function canToggleEntryAbsent(args: {
  entry: EntryStatusFields;
  edit: MatchEditContext & { isSelf: boolean };
}): boolean {
  const { entry, edit } = args;
  if (entry.is_dq) return false;
  if (!entry.is_absent && !isLikelyAbsent(entry)) return false;
  return canEditEntry(edit);
}
