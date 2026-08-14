import type { TypedSupabaseClient } from "../supabase/types";
import type { Shooter } from "./types";
import { unwrap } from "./unwrap";

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
  const data = unwrap(
    await supabase.rpc("my_discipline_counts", {
      p_user_id: userId,
    }),
    "listMyDisciplines",
  );

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
  const res = await supabase
    .from("match_entries")
    .select("id", { count: "exact", head: true })
    .in(
      "shooter_id",
      shooters.map((s) => s.id),
    );
  unwrap(res, "countMyMatchEntries");
  return res.count ?? 0;
}

/**
 * Devuelve todos los shooters linkeados al usuario.
 *
 * Un usuario puede tener varias identidades (una por cada variante de su
 * nombre que usaron los distintos torneos: PractiScore lo escribe como
 * "Apellido, Nombre", la planilla FBI como "Apellido Nombre", etc.). Por eso
 * todas las pantallas que muestran "lo mío" deben agregar a través de la lista.
 */
/**
 * Snapshot de un shooter para resolver el estado de claim antes de actuar.
 * Errores ignorados a propósito (igual que el original): devolvemos `null`
 * si no se encuentra o si la query falla.
 */
export async function getShooterClaimState(
  supabase: TypedSupabaseClient,
  shooterId: string,
): Promise<Pick<Shooter, "id" | "full_name" | "linked_user_id"> | null> {
  const { data } = await supabase
    .from("shooters")
    .select("id, full_name, linked_user_id")
    .eq("id", shooterId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Linkea un shooter al usuario solo si está libre (`linked_user_id` null).
 * Si ya está claimado por otro, el `.is(..., null)` hace que no afecte filas
 * (no es error). Devuelve `{ error }`.
 */
export async function claimShooter(
  supabase: TypedSupabaseClient,
  shooterId: string,
  userId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("shooters")
    .update({ linked_user_id: userId })
    .eq("id", shooterId)
    .is("linked_user_id", null);
  return { error: error?.message ?? null };
}

/**
 * Snapshot del nombre de un shooter que pertenece al usuario, antes de
 * desvincular. Solo matchea si `linked_user_id` es el del usuario.
 */
export async function getMyShooterName(
  supabase: TypedSupabaseClient,
  shooterId: string,
  userId: string,
): Promise<Pick<Shooter, "full_name"> | null> {
  const { data } = await supabase
    .from("shooters")
    .select("full_name")
    .eq("id", shooterId)
    .eq("linked_user_id", userId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Desvincula un shooter del usuario. Devuelve la cantidad de filas afectadas
 * (`affected`) para que la action decida si auditar — el update solo toca
 * filas que efectivamente eran del usuario.
 */
export async function unclaimShooter(
  supabase: TypedSupabaseClient,
  shooterId: string,
  userId: string,
): Promise<{ affected: number; error: string | null }> {
  const { data, error } = await supabase
    .from("shooters")
    .update({ linked_user_id: null })
    .eq("id", shooterId)
    .eq("linked_user_id", userId)
    .select("id");
  return {
    affected: Array.isArray(data) ? data.length : 0,
    error: error?.message ?? null,
  };
}

export async function listMyShooters(
  supabase: TypedSupabaseClient,
  userId: string,
): Promise<Shooter[]> {
  const data = unwrap(
    await supabase
      .from("shooters")
      .select("id, full_name, member_number, region, linked_user_id")
      .eq("linked_user_id", userId),
    "listMyShooters",
  );
  return data ?? [];
}

