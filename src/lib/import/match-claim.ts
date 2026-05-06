import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Auto-detección de claim al importar.
 *
 * Después de importar un match, buscamos shooters de ese match cuyo nombre
 * (o número de socio) coincide con el del profile del usuario, para sugerir
 * un "Soy yo" sin que el usuario tenga que ir a buscarlo.
 */

export interface ClaimCandidate {
  shooterId: string;
  fullName: string;
  memberNumber: string | null;
  divisionCode: string | null;
  /** Razón principal del match — útil para mostrar al usuario. */
  reason: "name" | "member_number";
}

/**
 * Devuelve los shooters de un match que parecen ser el usuario logueado.
 *
 * Soporta **múltiples identidades**: un mismo usuario puede tener varios
 * shooters linkeados (porque el nombre escrito en cada torneo varía: PractiScore
 * suele ser "Apellido, Nombre", la planilla FBI usa "Apellido Nombre", etc.).
 * Por eso, los aliases para matchear se construyen de:
 *   - `display_name` y `full_name` del profile.
 *   - El `full_name` de **todos** los shooters ya linkeados a este usuario.
 *   - El `member_number` del profile + los de los shooters ya linkeados.
 *
 * Reglas:
 *  - Solo considera shooters sin `linked_user_id` (claimables — los ya linkeados
 *    a este mismo usuario no se vuelven a sugerir).
 *  - Match por número de socio: coincidencia exacta.
 *  - Match por nombre: tokens normalizados (ver `areNamesSimilar`), requiriendo
 *    al menos 2 tokens distintos para evitar falsos positivos por apellidos comunes.
 */
export async function findClaimCandidates(
  supabase: SupabaseClient,
  userId: string,
  matchId: string,
): Promise<ClaimCandidate[]> {
  const [profileRes, linkedRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, full_name, member_number")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("shooters")
      .select("full_name, member_number")
      .eq("linked_user_id", userId),
  ]);

  const profile = profileRes.data as
    | { display_name: string | null; full_name: string | null; member_number: string | null }
    | null;
  const linkedShooters = (linkedRes.data ?? []) as Array<{
    full_name: string;
    member_number: string | null;
  }>;

  const aliasNames = [
    profile?.display_name,
    profile?.full_name,
    ...linkedShooters.map((s) => s.full_name),
  ].filter((s): s is string => typeof s === "string" && s.trim().length > 0);

  const aliasMembers = new Set<string>();
  if (profile?.member_number) aliasMembers.add(profile.member_number.trim());
  for (const s of linkedShooters) {
    if (s.member_number) aliasMembers.add(s.member_number.trim());
  }

  if (aliasNames.length === 0 && aliasMembers.size === 0) return [];

  type EntryRow = {
    divisions: { code: string } | null;
    shooters: {
      id: string;
      full_name: string;
      member_number: string | null;
      linked_user_id: string | null;
    } | null;
  };

  const { data } = await supabase
    .from("match_entries")
    .select(
      "divisions(code), shooters(id, full_name, member_number, linked_user_id)",
    )
    .eq("match_id", matchId);

  const entries = (data as unknown as EntryRow[] | null) ?? [];

  const candidates: ClaimCandidate[] = [];
  const seen = new Set<string>();

  for (const e of entries) {
    const shooter = e.shooters;
    if (!shooter) continue;
    if (shooter.linked_user_id) continue; // ya claimado (por este usuario o por otro)
    if (seen.has(shooter.id)) continue;

    const memberMatch =
      shooter.member_number !== null &&
      aliasMembers.has(shooter.member_number.trim());

    const nameMatch = aliasNames.some((alias) =>
      areNamesSimilar(alias, shooter.full_name),
    );

    if (memberMatch || nameMatch) {
      seen.add(shooter.id);
      candidates.push({
        shooterId: shooter.id,
        fullName: shooter.full_name,
        memberNumber: shooter.member_number,
        divisionCode: e.divisions?.code ?? null,
        reason: memberMatch ? "member_number" : "name",
      });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Algoritmo de matching de nombres — exportado para testing.
// ---------------------------------------------------------------------------

const DIACRITIC_RANGE = /[̀-ͯ]/gu;

/** Normaliza un nombre: minúsculas, sin acentos, sin puntuación, espacios colapsados. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(DIACRITIC_RANGE, "")
    .toLowerCase()
    .replace(/[,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokens del nombre, sin duplicados. */
export function nameTokens(s: string): Set<string> {
  return new Set(normalizeName(s).split(" ").filter(Boolean));
}

/**
 * True si los dos nombres parecen referirse al mismo tirador.
 * Requiere que el set más chico esté contenido en el más grande,
 * y que tenga al menos 2 tokens (nombre + apellido) — evita
 * que un apellido común genere falsos positivos.
 */
export function areNamesSimilar(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  const [smaller, larger] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (smaller.size < 2) return false;
  for (const t of smaller) {
    if (!larger.has(t)) return false;
  }
  return true;
}
