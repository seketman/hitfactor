import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Cliente de Supabase tipado con el schema generado (`npm run db:types`).
 *
 * Lo usan todas las funciones de data-access en lugar del `SupabaseClient`
 * genérico: así `.from(...)`, `.select(...)` y `.rpc(...)` infieren los tipos
 * de las filas desde `Database`, sin `as unknown as`.
 */
export type TypedSupabaseClient = SupabaseClient<Database>;
