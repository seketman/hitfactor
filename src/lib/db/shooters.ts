import type { SupabaseClient } from "@supabase/supabase-js";
import type { Shooter } from "./types";

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

