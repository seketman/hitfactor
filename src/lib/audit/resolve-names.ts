import type { TypedSupabaseClient } from "../supabase/types";

/**
 * Resuelve nombres legibles (arma + munición) para alimentar el audit log
 * con algo más útil que IDs crudos. Centraliza el patrón duplicado que vivía
 * inline en las acciones de firearms (`createFirearmUsage`, `setMatchFirearm`).
 *
 * Errores ignorados a propósito (igual que el código original): si la query
 * falla, devolvemos `null` para ese nombre — la auditoría es best-effort y no
 * debe romper la acción del usuario. Si `ammoId` es null/vacío, ni siquiera
 * consultamos la tabla de munición (la mayoría de los logs no tienen ammo).
 */
export async function resolveFirearmAndAmmoNames(
  supabase: TypedSupabaseClient,
  firearmId: string | null,
  ammoId: string | null,
): Promise<{ firearmName: string | null; ammoName: string | null }> {
  const [{ data: firearmRow }, { data: ammoRow }] = await Promise.all([
    firearmId
      ? supabase.from("firearms").select("name").eq("id", firearmId).maybeSingle()
      : Promise.resolve({ data: null }),
    ammoId
      ? supabase
          .from("ammunition_types")
          .select("name")
          .eq("id", ammoId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    firearmName: firearmRow?.name ?? null,
    ammoName: ammoRow?.name ?? null,
  };
}
