import type { TypedSupabaseClient } from "../supabase/types";
import type { FeedbackRow, FeedbackType } from "./types";
import { unwrap } from "./unwrap";

/**
 * Mínimo de participaciones (match_entries) que necesita un usuario para
 * poder enviar feedback. Filtra reportes prematuros de gente que recién
 * está probando la app sin haber importado un match real todavía.
 */
export const FEEDBACK_MIN_ENTRIES = 3;

interface CreateFeedbackInput {
  type: FeedbackType;
  message: string;
  pageUrl?: string | null;
}

/**
 * Inserta un reporte de feedback. La RLS exige que `user_id` matchee
 * `auth.uid()`. Devuelve `{ error }` para que la action lo maneje con
 * `redirectWithError` — no tiramos excepciones acá.
 */
export async function createFeedback(
  supabase: TypedSupabaseClient,
  userId: string,
  input: CreateFeedbackInput,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("feedback").insert({
    user_id: userId,
    type: input.type,
    message: input.message,
    page_url: input.pageUrl ?? null,
  });

  return { error: error?.message ?? null };
}

/**
 * Lista los reportes del usuario, más recientes primero. Usado en /about
 * para que el usuario vea el estado de lo que reportó.
 */
export async function listMyFeedback(
  supabase: TypedSupabaseClient,
  userId: string,
  limit: number = 20,
): Promise<FeedbackRow[]> {
  const data = unwrap(
    await supabase
      .from("feedback")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit),
    "listMyFeedback",
  );

  // `type` and `status` are narrower than their `text` columns; the CHECK
  // constraints are what make that sound. See `db/types.ts`.
  return (data as FeedbackRow[] | null) ?? [];
}
