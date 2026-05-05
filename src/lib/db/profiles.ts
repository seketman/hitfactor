import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "./types";

export async function getProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<Profile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, full_name, member_number")
    .eq("id", userId)
    .maybeSingle();
  return (data as Profile | null) ?? null;
}
