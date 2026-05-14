import { cache } from "react";
import type { TypedSupabaseClient } from "../supabase/types";
import type { Club } from "./types";

/**
 * Lista de clubs habilitados para autoselect en la UI de "Editar club".
 *
 * Es el catálogo único, vive en DB para poder ampliarse sin redeploy. La
 * lista cambia muy poco, así que la envolvemos en `cache()` (React): dentro
 * de un mismo request las páginas que la necesitan (`/matches`, el detalle
 * del match, su vista "me", el dashboard) comparten una sola consulta en
 * lugar de pegarle a la DB una vez por página. Depende de que el cliente
 * `supabase` sea estable por request — lo es, ver `createClient`.
 */
export const listClubs = cache(
  async (supabase: TypedSupabaseClient): Promise<Club[]> => {
    const { data } = await supabase
      .from("clubs")
      .select("code, name, country, zone")
      .order("name", { ascending: true });
    return (data as Club[] | null) ?? [];
  },
);
