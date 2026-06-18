import type { TypedSupabaseClient } from "../supabase/types";
import type { ParsedShooter } from "@/lib/types/match";
import { ImportError } from "./import-error";

/** Clave de cache para deduplicar tiradores dentro del mismo import. */
export function shooterCacheKey(s: ParsedShooter): string {
  return `${s.fullName.trim().toLowerCase()}|${s.memberNumber ?? ""}`;
}

/**
 * Resuelve un batch de shooters parseados a sus `id`s de DB en pocas
 * round-trips, en lugar de un round-trip por shooter como hacía la
 * versión per-row.
 *
 * Estrategia (en orden de prioridad):
 *  1. Dedup por `shooterCacheKey` (lowercase fullName + memberNumber).
 *  2. 1 SELECT con `.in('member_number', uniqueNumbers)` para reusar
 *     shooters ya conocidos cuando el import trae número de socio. El
 *     número es un identificador estable que sobrevive a typos del
 *     apellido (caso real: el mismo Oscar Stocker tipeado como "Stoker
 *     Oscar" sin número y como "STOCKER, Oscar Alfredo" con número 793 —
 *     el número los une cuando alguno de los imports lo trae).
 *  3. 1 SELECT con `.in('full_name', uniqueNames)` para los que todavía
 *     no resolvió el paso 2 (case-sensitive — el hit rate es ~100% en
 *     re-uploads del mismo formato).
 *  4. Fallback a `findOrCreateShooter` per-row para los misses, que usa
 *     `ilike` (case-insensitive) e inserta si tampoco existe con otra
 *     capitalización.
 *
 * Devuelve un `Map<shooterCacheKey, shooterId>` listo para ser consultado
 * por el caller sin más round-trips.
 */
export async function resolveShootersBulk(
  supabase: TypedSupabaseClient,
  parsedShooters: ParsedShooter[],
): Promise<Map<string, string>> {
  const cache = new Map<string, string>();

  const uniqueByKey = new Map<string, ParsedShooter>();
  for (const s of parsedShooters) {
    if (!s.fullName?.trim()) continue;
    uniqueByKey.set(shooterCacheKey(s), s);
  }
  const unique = [...uniqueByKey.values()];
  if (unique.length === 0) return cache;

  // Paso 2: bulk lookup por member_number. Solo consultamos los parsed
  // shooters que traen número — si no, no hay nada que matchear acá.
  const memberNumbers = [
    ...new Set(
      unique
        .map((s) => s.memberNumber?.trim())
        .filter((n): n is string => !!n),
    ),
  ];
  const dbByMemberNumber = new Map<string, string>();
  if (memberNumbers.length > 0) {
    const { data: byNumberRows } = await supabase
      .from("shooters")
      .select("id, member_number, linked_user_id, created_at")
      .in("member_number", memberNumbers);

    // Si la DB tiene >1 shooter con el mismo número (no debería pero
    // puede pasar por imports duplicados pre-fix), preferimos el linkeado
    // y más viejo — mismo criterio que el path por nombre.
    const grouped = new Map<
      string,
      Array<{ id: string; linked: boolean; createdAt: string }>
    >();
    for (const row of byNumberRows ?? []) {
      const num = (row.member_number as string | null)?.trim();
      if (!num) continue;
      const arr = grouped.get(num) ?? [];
      arr.push({
        id: row.id as string,
        linked: row.linked_user_id != null,
        createdAt: (row.created_at as string) ?? "",
      });
      grouped.set(num, arr);
    }
    for (const [num, candidates] of grouped) {
      candidates.sort((a, b) => {
        if (a.linked !== b.linked) return a.linked ? -1 : 1;
        return a.createdAt.localeCompare(b.createdAt);
      });
      dbByMemberNumber.set(num, candidates[0]!.id);
    }
  }

  // Paso 3: bulk fetch por nombre exacto. Solo para los que todavía no
  // resolvió el paso 2.
  const stillUnresolved = unique.filter((s) => {
    const num = s.memberNumber?.trim();
    return !(num && dbByMemberNumber.has(num));
  });
  const names = [...new Set(stillUnresolved.map((s) => s.fullName))];
  const dbByKey = new Map<
    string,
    Array<{ id: string; linked: boolean; createdAt: string }>
  >();
  if (names.length > 0) {
    const { data: rows } = await supabase
      .from("shooters")
      .select("id, full_name, member_number, linked_user_id, created_at")
      .in("full_name", names);

    for (const row of rows ?? []) {
      const key = shooterCacheKey({
        fullName: row.full_name as string,
        memberNumber: (row.member_number as string | null) ?? null,
        region: null,
      });
      const arr = dbByKey.get(key) ?? [];
      arr.push({
        id: row.id as string,
        linked: row.linked_user_id != null,
        createdAt: (row.created_at as string) ?? "",
      });
      dbByKey.set(key, arr);
    }
  }

  const missing: ParsedShooter[] = [];
  for (const s of unique) {
    const key = shooterCacheKey(s);

    // Match por número de socio gana sobre match por nombre.
    const num = s.memberNumber?.trim();
    if (num) {
      const byNumber = dbByMemberNumber.get(num);
      if (byNumber) {
        cache.set(key, byNumber);
        continue;
      }
    }

    const candidates = dbByKey.get(key);
    if (!candidates || candidates.length === 0) {
      missing.push(s);
      continue;
    }
    candidates.sort((a, b) => {
      if (a.linked !== b.linked) return a.linked ? -1 : 1;
      return a.createdAt.localeCompare(b.createdAt);
    });
    cache.set(key, candidates[0]!.id);
  }

  // Paso 4: fallback per-row para los misses. Usa ilike (recupera
  // case-variants) y crea si no existe.
  for (const s of missing) {
    const id = await findOrCreateShooter(supabase, s);
    cache.set(shooterCacheKey(s), id);
  }

  return cache;
}

async function findOrCreateShooter(
  supabase: TypedSupabaseClient,
  parsed: ParsedShooter,
): Promise<string> {
  // Usamos `limit(1)` + orden estable en lugar de `maybeSingle()` porque
  // este último devuelve null silenciosamente cuando hay >1 match —
  // típicamente porque ya hay shooters duplicados en la DB de imports
  // anteriores. Si ese null caía a INSERT, generábamos un duplicado más.
  // Acá, si encontramos al menos uno, lo reusamos (preferimos los que
  // tienen claim para no romper el linkeo del usuario).
  let query = supabase
    .from("shooters")
    .select("id")
    .ilike("full_name", parsed.fullName);

  if (parsed.memberNumber) {
    query = query.eq("member_number", parsed.memberNumber);
  } else {
    query = query.is("member_number", null);
  }

  const { data: existing } = await query
    .order("linked_user_id", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(1);
  if (existing && existing.length > 0) return existing[0]!.id as string;

  const { data: created, error } = await supabase
    .from("shooters")
    .insert({
      full_name: parsed.fullName,
      member_number: parsed.memberNumber,
      region: parsed.region,
    })
    .select("id")
    .single();

  if (error) throw new ImportError(error.message, "SHOOTER_INSERT_FAILED");
  return created!.id as string;
}
