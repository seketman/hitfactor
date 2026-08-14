import { cache } from "react";
import type { TypedSupabaseClient } from "../supabase/types";
import type { Json } from "../supabase/database.types";
import type { Profile, UiPrefs } from "./types";
import { unwrap } from "./unwrap";

/**
 * Perfil de un usuario. Envuelto en `cache()` (React): el layout lo pide para
 * el usuario logueado y varias páginas lo vuelven a pedir (ej. el detalle del
 * match, para el "importado por X") — dentro de un request las llamadas con el
 * mismo `(supabase, userId)` comparten una sola consulta. Depende de que el
 * cliente `supabase` sea estable por request, ver `createClient`.
 */
export const getProfile = cache(
  async (
    supabase: TypedSupabaseClient,
    userId: string,
  ): Promise<Profile | null> => {
    const data = unwrap(
      await supabase
        .from("profiles")
        .select("id, display_name, full_name, member_number, is_admin")
        .eq("id", userId)
        .maybeSingle(),
      "getProfile",
    );
    return data ?? null;
  },
);

/**
 * Lee las UI prefs del usuario. Si el row no existe (caso raro, solo en
 * tests) o `ui_prefs` está null, devuelve `{}` — los callers usan defaults
 * para las keys que faltan.
 */
export async function getUiPrefs(
  supabase: TypedSupabaseClient,
  userId: string,
): Promise<UiPrefs> {
  const data = unwrap(
    await supabase
      .from("profiles")
      .select("ui_prefs")
      .eq("id", userId)
      .maybeSingle(),
    "getUiPrefs",
  );
  const prefs = (data as { ui_prefs: UiPrefs | null } | null)?.ui_prefs;
  return prefs ?? {};
}

/**
 * Merge-update de UI prefs sobre la fila del usuario actual (`auth.uid()`).
 *
 * Delega en la RPC `update_ui_prefs` (migración 0018), que hace el merge en
 * una sola sentencia `jsonb || patch` — atómico, sin la ventana de lost-update
 * del viejo read-modify-write en JS, y propagando el error en vez de
 * descartarlo (issue #126). No toma `userId`: la RPC apunta a `auth.uid()`.
 */
export async function updateUiPrefs(
  supabase: TypedSupabaseClient,
  patch: Partial<UiPrefs>,
): Promise<void> {
  const { error } = await supabase.rpc("update_ui_prefs", {
    patch: patch as Json,
  });
  if (error) {
    throw new Error(`[db:updateUiPrefs] ${error.message}`);
  }
}
