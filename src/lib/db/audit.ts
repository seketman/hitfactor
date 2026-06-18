import type { TypedSupabaseClient } from "../supabase/types";
import type { AuditLogRow } from "./types";
import { unwrap } from "./unwrap";

const DEFAULT_PAGE_SIZE = 50;

/**
 * Devuelve una página de entradas de audit_log del usuario, más recientes
 * primero. La RLS ya filtra por usuario, pero igual filtramos explícitamente
 * para que la query use el índice `(user_id, created_at desc)`.
 *
 * Pagina con `page` (1-indexed) + `pageSize`. Devuelve también el `count`
 * total para que la UI pueda mostrar "Página X de Y".
 */
export async function listAuditLog(
  supabase: TypedSupabaseClient,
  userId: string,
  page: number = 1,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<{ rows: AuditLogRow[]; total: number; pageSize: number }> {
  const safePage = Math.max(1, Math.floor(page));
  const from = (safePage - 1) * pageSize;
  const to = from + pageSize - 1;

  const res = await supabase
    .from("audit_log")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(from, to);
  const data = unwrap(res, "listAuditLog");

  return {
    rows: (data as AuditLogRow[] | null) ?? [],
    total: res.count ?? 0,
    pageSize,
  };
}
