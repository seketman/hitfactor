import type { SupabaseClient } from "@supabase/supabase-js";
import type { Shooter } from "./types";

/**
 * Devuelve el shooter linkeado al usuario, o null si todavía no claimó ninguno.
 */
export async function getMyShooter(
  supabase: SupabaseClient,
  userId: string,
): Promise<Shooter | null> {
  const { data } = await supabase
    .from("shooters")
    .select("id, full_name, member_number, region, linked_user_id")
    .eq("linked_user_id", userId)
    .maybeSingle();
  return (data as Shooter | null) ?? null;
}
