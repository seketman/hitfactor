import type { TypedSupabaseClient } from "../supabase/types";

export interface MatchLookupRow {
  id: string;
  name: string;
  imported_by_user_id: string;
  /**
   * Estado actual del `min_shots` del match en DB. Lo usamos en re-uploads
   * y stage imports para decidir si aplicar el valor que vino en el form:
   * solo lo seteamos cuando todavía es null, así no pisamos un valor que
   * el usuario haya corregido a mano desde la página del match.
   */
  min_shots: number | null;
}

/**
 * Busca un match del usuario por (discipline, name, date), **ignorando la
 * region**. Se usa antes de insertar para detectar re-uploads incluso si
 * el region en DB fue editado por el usuario después del import original
 * (ej. botón "Editar club" en /matches/[id]).
 *
 * Si hay más de uno (caso anómalo de duplicados pre-existentes en DB),
 * elegimos el más antiguo — asumiendo que ese fue el "original" y que
 * los más nuevos son ramas erróneas a limpiar.
 */
export async function findUserMatch(
  supabase: TypedSupabaseClient,
  disciplineId: number,
  name: string,
  date: string,
  importerUserId: string,
): Promise<MatchLookupRow | null> {
  const { data } = await supabase
    .from("matches")
    .select("id, name, imported_by_user_id, min_shots, imported_at")
    .eq("discipline_id", disciplineId)
    .eq("name", name)
    .eq("date", date)
    .eq("imported_by_user_id", importerUserId)
    .order("imported_at", { ascending: true })
    .limit(1);
  const rows = data as MatchLookupRow[] | null;
  return rows && rows.length > 0 ? rows[0]! : null;
}

/**
 * Busca un match de CUALQUIER usuario por (discipline, name, date),
 * ignorando region. Sirve para detectar duplicados cross-user que la
 * unique constraint a nivel DB no agarra (region distinta entre dos
 * imports del mismo torneo real — típicamente HTML vs PDF, ver Issue
 * #88 / PR #89). Si hay más de uno (legacy state), devuelve el más
 * antiguo asumiendo que ese es el "original".
 */
export async function findAnyMatchByDiscNameDate(
  supabase: TypedSupabaseClient,
  disciplineId: number,
  name: string,
  date: string,
): Promise<{
  id: string;
  imported_by_user_id: string;
  region: string | null;
} | null> {
  const { data } = await supabase
    .from("matches")
    .select("id, imported_by_user_id, region, imported_at")
    .eq("discipline_id", disciplineId)
    .eq("name", name)
    .eq("date", date)
    .order("imported_at", { ascending: true })
    .limit(1);
  const rows = data as Array<{
    id: string;
    imported_by_user_id: string;
    region: string | null;
  }> | null;
  return rows && rows.length > 0 ? rows[0]! : null;
}
