import type { TypedSupabaseClient } from "../supabase/types";

/**
 * The two lookups below run the same filter — discipline + name + date,
 * oldest first, one row — and differ only in whether they scope to the
 * importer. They are deliberately **not** merged behind an optional user
 * parameter.
 *
 * What they share is five chained calls. What they do not share is the shape:
 * one needs the embedded `match_entries(count)` aggregate to tell a real match
 * from the leftovers of a half-failed import, the other needs `region` to
 * decide whether two imports describe the same real tournament. Merging them
 * means selecting different columns per branch, and `supabase-js` infers the
 * row type from the select string as a literal — so a computed select gives up
 * that inference and pushes the result straight into an `as` cast. That trade
 * buys five lines and costs type safety, which is the wrong direction (#122).
 */

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
  /**
   * Cuántos `match_entries` tiene ya el match.
   *
   * **0 significa que este match es el resto de un import que falló a la
   * mitad** (#205): la fila de `matches` se insertó y el paso siguiente no
   * llegó a completarse. Encontrarlo acá no cambia lo que hacemos —el
   * merge lo termina de poblar igual, que es lo que el usuario quería— pero
   * sí cambia lo que le decimos: "ya existía" es falso para un match que
   * nunca tuvo resultados.
   */
  entryCount: number;
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
  // `match_entries(count)` es un agregado embebido de PostgREST: viene en la
  // misma consulta, así que saber si el match tiene resultados no cuesta un
  // round-trip extra. Llega como `[{ count: n }]`.
  const { data } = await supabase
    .from("matches")
    .select(
      "id, name, imported_by_user_id, min_shots, imported_at, match_entries(count)",
    )
    .eq("discipline_id", disciplineId)
    .eq("name", name)
    .eq("date", date)
    .eq("imported_by_user_id", importerUserId)
    .order("imported_at", { ascending: true })
    .limit(1);

  const rows = data as
    | Array<Omit<MatchLookupRow, "entryCount"> & {
        match_entries: Array<{ count: number }> | null;
      }>
    | null;
  const row = rows && rows.length > 0 ? rows[0]! : null;
  if (!row) return null;

  const { match_entries, ...rest } = row;
  return { ...rest, entryCount: match_entries?.[0]?.count ?? 0 };
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
