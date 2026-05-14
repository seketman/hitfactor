import type { TypedSupabaseClient } from "../supabase/types";
import type { Shooter } from "./types";

/**
 * Disciplinas en las que el usuario tiene al menos una participación, con el
 * conteo de participaciones en cada una. Se usa para construir el menú lateral
 * con solo las disciplinas relevantes.
 *
 * Corre en cada page load (vive en `AppSidebar`), así que la agregación se
 * hace en la DB vía el RPC `my_discipline_counts` — antes esto se traía
 * TODAS las match_entries del usuario y contaba en JS. El RPC ya resuelve las
 * identidades del usuario internamente y devuelve a lo sumo 4 filas.
 */
export async function listMyDisciplines(
  supabase: TypedSupabaseClient,
  userId: string,
): Promise<Array<{ code: string; name: string; count: number }>> {
  const { data } = await supabase.rpc("my_discipline_counts", {
    p_user_id: userId,
  });

  return (data ?? []).map((r) => ({
    code: r.code,
    name: r.name,
    // count viene de un count(*)::bigint — PostgREST lo serializa como number.
    count: Number(r.count),
  }));
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
  supabase: TypedSupabaseClient,
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
  supabase: TypedSupabaseClient,
  userId: string,
): Promise<Shooter[]> {
  const { data } = await supabase
    .from("shooters")
    .select("id, full_name, member_number, region, linked_user_id")
    .eq("linked_user_id", userId);
  return (data as Shooter[] | null) ?? [];
}

