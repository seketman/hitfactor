import type { TypedSupabaseClient } from "../supabase/types";
import {
  getMyClaimAliases,
  hasUsefulAliases,
  isClaimCandidate,
} from "../import/match-claim";

/**
 * Sugerencia de claim presentada al usuario en el header de `/matches`
 * cuando todavía no claimó ninguna identidad. Contiene tanto el shooter
 * (objetivo del claim) como el contexto del match más reciente donde
 * aparece — sin eso, "linkeate con Juan Perez" no le dice nada al usuario
 * sobre dónde lo encontramos.
 */
export interface ClaimSuggestion {
  shooterId: string;
  shooterName: string;
  memberNumber: string | null;
  matchId: string;
  matchName: string;
  /** ISO date string del match (YYYY-MM-DD). */
  matchDate: string;
  divisionCode: string | null;
  divisionName: string | null;
  disciplineName: string | null;
  /** Puesto del shooter en ese match (para que el user se reconozca). */
  place: number;
}

/**
 * Encuentra candidatos a "Soy yo" para el usuario en cuestión, cruzados
 * con sus match_entries más recientes. Diseñado para el onboarding:
 * mostrar "te encontramos en estos matches" arriba del listado.
 *
 * Reglas:
 *  - Solo shooters con `linked_user_id IS NULL` (no claimados).
 *  - Filtra con `isClaimCandidate` (nombre/socio similares), pero exigimos
 *    aliases útiles primero — si el profile solo tiene 1 token, el matcher
 *    cae al modo "todo es candidato" y sugeriríamos cientos. En ese caso
 *    devolvemos vacío y el UI le pide al user buscar manualmente.
 *  - Un shooter aparece una sola vez (el match más reciente). Si el mismo
 *    nombre aparece en 5 torneos distintos, mostramos solo el más reciente
 *    — claimando uno se linkean automáticamente todas sus entries.
 *  - Orden: por fecha del match descendente (el más reciente arriba).
 *
 * El `limit` default de 5 es bajo a propósito: si mostramos más, el
 * onboarding pierde foco. Si ninguno de los 5 es el usuario, "Ocultar
 * sugerencias" cubre el escape.
 */
export async function findClaimSuggestions(
  supabase: TypedSupabaseClient,
  userId: string,
  opts: { limit?: number } = {},
): Promise<ClaimSuggestion[]> {
  const limit = opts.limit ?? 5;

  const aliases = await getMyClaimAliases(supabase, userId);
  if (!hasUsefulAliases(aliases)) return [];

  // `shooters!inner` con filtro `linked_user_id is null` ya descarta del lado
  // de la DB los shooters claimados. Traemos match + disciplina + división en
  // un solo round-trip, ordenados por fecha del match desc para que al
  // recorrer en JS encontremos primero el entry más reciente de cada shooter.
  const { data } = await supabase
    .from("match_entries")
    .select(
      "place, shooters!inner(id, full_name, member_number, linked_user_id), divisions(code, name), matches!inner(id, name, date, disciplines(name))",
    )
    .is("shooters.linked_user_id", null)
    .order("date", { foreignTable: "matches", ascending: false });

  if (!data) return [];

  const suggestions: ClaimSuggestion[] = [];
  const seen = new Set<string>();

  for (const row of data) {
    if (suggestions.length >= limit) break;
    const shooter = row.shooters;
    const match = row.matches;
    if (!shooter || !match) continue;
    if (seen.has(shooter.id)) continue;
    if (!isClaimCandidate(shooter, aliases)) continue;

    seen.add(shooter.id);
    suggestions.push({
      shooterId: shooter.id,
      shooterName: shooter.full_name,
      memberNumber: shooter.member_number,
      matchId: match.id,
      matchName: match.name,
      matchDate: match.date,
      divisionCode: row.divisions?.code ?? null,
      divisionName: row.divisions?.name ?? null,
      disciplineName: match.disciplines?.name ?? null,
      place: row.place,
    });
  }

  return suggestions;
}
