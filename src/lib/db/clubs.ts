import type { SupabaseClient } from "@supabase/supabase-js";
import type { Club } from "./types";

/**
 * Lista de clubs habilitados para autoselect en la UI de "Editar club".
 *
 * Es el catálogo único, vive en DB para poder ampliarse sin redeploy
 * (ver supabase/migrations/0008_clubs.sql). Los nombres/códigos se cachean
 * por request — la lista cambia muy poco.
 */
export async function listClubs(supabase: SupabaseClient): Promise<Club[]> {
  const { data } = await supabase
    .from("clubs")
    .select("code, name, country")
    .order("name", { ascending: true });
  return (data as Club[] | null) ?? [];
}
