import type { TypedSupabaseClient } from "../supabase/types";
import type { AuditLogRow } from "./types";
import { unwrap } from "./unwrap";

const DEFAULT_PAGE_SIZE = 50;

/**
 * Narrows `audit_log.metadata` to the object shape the domain type promises.
 *
 * This is the one narrowing in `db/` the database does not stand behind. The
 * column is plain `jsonb` (`0001_initial_schema.sql`, `create table
 * public.audit_log`) with no CHECK, and JSONB accepts `"a string"`, `42`,
 * `true` or `[1, 2]` just as happily as an object — so declaring it
 * `Record<string, unknown> | null` was an assertion, not a fact. Every other
 * narrowed column in `db/` has a CHECK constraint; those are catalogued in
 * `tests/db-narrowing-constraints.test.ts`.
 *
 * A value that is not a plain object becomes `null` and says so in the server
 * log. Throwing would take the whole activity page down over one malformed
 * row, and returning it as-is is what put the lie in the type to begin with.
 *
 * Exported for `tests/db-narrowing-constraints.test.ts`: this is the one
 * narrowing in `db/` decided in TypeScript rather than by the schema, so it is
 * also the only one that can be got wrong without a migration.
 */
export function asMetadata(
  value: unknown,
  rowId: number,
): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    // Genuinely a narrowing: TypeScript stops at `object`, which has no index
    // signature, and cannot get to `Record<string, unknown>` on its own.
    return value as Record<string, unknown>;
  }
  console.warn(
    `[db/audit] audit_log row ${rowId}: metadata is ${
      Array.isArray(value) ? "an array" : typeof value
    }, expected an object — read as null`,
  );
  return null;
}

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
    rows: (data ?? []).map((row) => ({
      ...row,
      metadata: asMetadata(row.metadata, row.id),
    })),
    total: res.count ?? 0,
    pageSize,
  };
}
