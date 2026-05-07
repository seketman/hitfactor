import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Auto-detección de claim al importar y filtrado de "Soy yo" en la vista
 * pública del match.
 *
 * Soporta **múltiples identidades**: un mismo usuario puede tener varios
 * shooters linkeados (porque el nombre escrito en cada torneo varía:
 * PractiScore suele ser "Apellido, Nombre", la planilla FBI usa
 * "Apellido Nombre", etc.). Los aliases para matchear se construyen de:
 *   - `display_name` y `full_name` del profile.
 *   - El `full_name` de **todos** los shooters ya linkeados a este usuario.
 *   - El `member_number` del profile + los de los shooters ya linkeados.
 */

export interface ClaimCandidate {
  shooterId: string;
  fullName: string;
  memberNumber: string | null;
  divisionCode: string | null;
  /** Razón principal del match — útil para mostrar al usuario. */
  reason: "name" | "member_number";
}

export interface ClaimAliases {
  /** Nombres conocidos del usuario (profile + shooters linkeados). */
  names: string[];
  /** Números de socio conocidos. */
  memberNumbers: Set<string>;
}

interface ProfileLike {
  display_name?: string | null;
  full_name?: string | null;
  member_number?: string | null;
}

interface ShooterLike {
  full_name: string;
  member_number: string | null;
}

/**
 * Construye el set de aliases del usuario a partir del profile + sus shooters
 * ya linkeados. Pure function — testeable.
 */
export function buildClaimAliases(
  profile: ProfileLike | null,
  linkedShooters: ShooterLike[],
): ClaimAliases {
  const names = [
    profile?.display_name,
    profile?.full_name,
    ...linkedShooters.map((s) => s.full_name),
  ].filter((s): s is string => typeof s === "string" && s.trim().length > 0);

  const memberNumbers = new Set<string>();
  if (profile?.member_number) memberNumbers.add(profile.member_number.trim());
  for (const s of linkedShooters) {
    if (s.member_number) memberNumbers.add(s.member_number.trim());
  }

  return { names, memberNumbers };
}

/**
 * True si los aliases son útiles para discriminar (i.e., al menos un nombre
 * con ≥2 tokens, o algún número de socio).
 *
 * Con aliases pobres (ej: profile recién creado con display_name "Diego" =
 * 1 token) no podemos filtrar — `areNamesSimilar` exige ≥2 tokens en común
 * y rechazaría todo. En ese caso preferimos mostrar "Soy yo" en todos los
 * shooters no claimados, así el usuario puede hacer su primer claim manual.
 * Una vez linkeado un shooter con nombre completo (≥2 tokens), los aliases
 * pasan a ser útiles y el filtro arranca.
 */
function hasUsefulAliases(aliases: ClaimAliases): boolean {
  if (aliases.memberNumbers.size > 0) return true;
  return aliases.names.some((name) => nameTokens(name).size >= 2);
}

/**
 * True si un shooter dado tiene similitud razonable con los aliases del
 * usuario actual. Pensado para filtrar el botón "Soy yo" en la vista pública
 * del match.
 *
 * Bootstrap: si los aliases no son útiles (1 token o vacíos), devuelve true
 * para no bloquear el primer claim manual.
 */
export function isClaimCandidate(
  shooter: ShooterLike,
  aliases: ClaimAliases,
): boolean {
  if (!hasUsefulAliases(aliases)) return true;

  if (
    shooter.member_number != null &&
    aliases.memberNumbers.has(shooter.member_number.trim())
  ) {
    return true;
  }

  return aliases.names.some((alias) =>
    areNamesSimilar(alias, shooter.full_name),
  );
}

/**
 * Devuelve los shooters de un match que parecen ser el usuario logueado.
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

  const profile = profileRes.data as ProfileLike | null;
  const linkedShooters = (linkedRes.data ?? []) as ShooterLike[];
  const aliases = buildClaimAliases(profile, linkedShooters);

  if (aliases.names.length === 0 && aliases.memberNumbers.size === 0) {
    return [];
  }

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
      aliases.memberNumbers.has(shooter.member_number.trim());

    const nameMatch = aliases.names.some((alias) =>
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

/**
 * Carga los aliases del usuario actual: profile + shooters ya linkeados.
 * Lo usa la vista pública del match para filtrar el botón "Soy yo".
 */
export async function getMyClaimAliases(
  supabase: SupabaseClient,
  userId: string,
): Promise<ClaimAliases> {
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

  return buildClaimAliases(
    profileRes.data as ProfileLike | null,
    (linkedRes.data ?? []) as ShooterLike[],
  );
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
