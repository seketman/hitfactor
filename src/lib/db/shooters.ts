import type { SupabaseClient } from "@supabase/supabase-js";
import type { Shooter } from "./types";

/**
 * Disciplinas en las que el usuario tiene al menos una participación.
 * Se usa para construir el menú lateral con solo las disciplinas relevantes.
 */
export async function listMyDisciplines(
  supabase: SupabaseClient,
  userId: string,
): Promise<Array<{ code: string; name: string; count: number }>> {
  // Obtener mis shooters (puede haber varias identidades).
  const shooters = await listMyShooters(supabase, userId);
  if (shooters.length === 0) return [];

  type Row = {
    matches: { disciplines: { code: string; name: string } | null } | null;
  };

  const { data } = await supabase
    .from("match_entries")
    .select("matches(disciplines(code, name))")
    .in(
      "shooter_id",
      shooters.map((s) => s.id),
    );

  const counts = new Map<string, { code: string; name: string; count: number }>();
  for (const row of (data as unknown as Row[] | null) ?? []) {
    const d = row.matches?.disciplines;
    if (!d?.code) continue;
    const existing = counts.get(d.code);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(d.code, { code: d.code, name: d.name, count: 1 });
    }
  }
  return Array.from(counts.values()).sort((a, b) => b.count - a.count);
}

/**
 * Cuenta total de match_entries del usuario, agregando todas sus identidades.
 * Una "participación" = un match_entry (un match × una división por shooter).
 * Tres participaciones pueden ser un torneo en 3 divisiones, 3 torneos
 * distintos, o cualquier combinación.
 *
 * Se usa para gatear features (ej: feedback) detrás de un mínimo de actividad.
 */
export async function countMyMatchEntries(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const shooters = await listMyShooters(supabase, userId);
  if (shooters.length === 0) return 0;
  const { count } = await supabase
    .from("match_entries")
    .select("id", { count: "exact", head: true })
    .in(
      "shooter_id",
      shooters.map((s) => s.id),
    );
  return count ?? 0;
}

/**
 * Devuelve todos los shooters linkeados al usuario.
 *
 * Un usuario puede tener varias identidades (una por cada variante de su
 * nombre que usaron los distintos torneos: PractiScore lo escribe como
 * "Apellido, Nombre", la planilla FBI como "Apellido Nombre", etc.). Por eso
 * todas las pantallas que muestran "lo mío" deben agregar a través de la lista.
 */
export async function listMyShooters(
  supabase: SupabaseClient,
  userId: string,
): Promise<Shooter[]> {
  const { data } = await supabase
    .from("shooters")
    .select("id, full_name, member_number, region, linked_user_id")
    .eq("linked_user_id", userId);
  return (data as Shooter[] | null) ?? [];
}

