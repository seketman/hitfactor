import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile, UiPrefs } from "./types";

/**
 * Perfil de un usuario. Envuelto en `cache()` (React): el layout lo pide para
 * el usuario logueado y varias páginas lo vuelven a pedir (ej. el detalle del
 * match, para el "importado por X") — dentro de un request las llamadas con el
 * mismo `(supabase, userId)` comparten una sola consulta. Depende de que el
 * cliente `supabase` sea estable por request, ver `createClient`.
 */
export const getProfile = cache(
  async (
    supabase: SupabaseClient,
    userId: string,
  ): Promise<Profile | null> => {
    const { data } = await supabase
      .from("profiles")
      .select("id, display_name, full_name, member_number")
      .eq("id", userId)
      .maybeSingle();
    return (data as Profile | null) ?? null;
  },
);

/**
 * Lee las UI prefs del usuario. Si el row no existe (caso raro, solo en
 * tests) o `ui_prefs` está null, devuelve `{}` — los callers usan defaults
 * para las keys que faltan.
 */
export async function getUiPrefs(
  supabase: SupabaseClient,
  userId: string,
): Promise<UiPrefs> {
  const { data } = await supabase
    .from("profiles")
    .select("ui_prefs")
    .eq("id", userId)
    .maybeSingle();
  const prefs = (data as { ui_prefs: UiPrefs | null } | null)?.ui_prefs;
  return prefs ?? {};
}

/**
 * Merge-update de UI prefs: lee el JSON actual, le aplica el patch y lo
 * vuelve a escribir. Hacemos read-modify-write para no perder keys que el
 * caller no manda — la alternativa es `jsonb_set` por key, que requiere
 * RPC y complica la API para una columna que se actualiza rara vez.
 */
export async function updateUiPrefs(
  supabase: SupabaseClient,
  userId: string,
  patch: Partial<UiPrefs>,
): Promise<void> {
  const current = await getUiPrefs(supabase, userId);
  const next = { ...current, ...patch };
  await supabase.from("profiles").update({ ui_prefs: next }).eq("id", userId);
}
