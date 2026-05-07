"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { redirectWithError } from "@/lib/redirects";
import { createFeedback } from "@/lib/db/feedback";
import type { FeedbackType } from "@/lib/db/types";

const VALID_TYPES: FeedbackType[] = ["bug", "suggestion", "other"];
const MIN_LENGTH = 10;
const MAX_LENGTH = 4000;

/**
 * Envía un reporte de feedback (bug/sugerencia/otro) desde la página /about.
 * En éxito redirige a `/about?sent=1` para mostrar un confirm message.
 */
export async function submitFeedback(formData: FormData) {
  const type = String(formData.get("type") ?? "") as FeedbackType;
  const message = String(formData.get("message") ?? "").trim();
  const pageUrl = String(formData.get("page_url") ?? "").trim() || null;

  if (!VALID_TYPES.includes(type)) {
    redirectWithError("/about", "Tipo de reporte inválido");
  }
  if (message.length < MIN_LENGTH) {
    redirectWithError(
      "/about",
      `El mensaje es muy corto (mínimo ${MIN_LENGTH} caracteres)`,
    );
  }
  if (message.length > MAX_LENGTH) {
    redirectWithError(
      "/about",
      `El mensaje es muy largo (máximo ${MAX_LENGTH} caracteres)`,
    );
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const { error } = await createFeedback(supabase, userData.user.id, {
    type,
    message,
    pageUrl,
  });

  if (error) {
    redirectWithError("/about", "No se pudo enviar el reporte: " + error);
  }

  revalidatePath("/about");
  redirect("/about?sent=1");
}
