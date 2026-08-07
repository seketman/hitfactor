"use server";

import { getLocale, getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { redirectWithError } from "@/lib/redirects";
import { requireUser } from "@/lib/supabase/require-user";
import { createFeedback, FEEDBACK_MIN_ENTRIES } from "@/lib/db/feedback";
import { countMyMatchEntries } from "@/lib/db/shooters";
import type { FeedbackType } from "@/lib/db/types";

const VALID_TYPES: FeedbackType[] = ["bug", "suggestion", "other"];
const MIN_LENGTH = 10;
const MAX_LENGTH = 4000;

/**
 * Envía un reporte de feedback (bug/sugerencia/otro) desde la página /about.
 * En éxito redirige a `/about?sent=1` para mostrar un confirm message.
 */
export async function submitFeedback(formData: FormData) {
  const locale = await getLocale();
  const t = await getTranslations("actionError");
  const type = String(formData.get("type") ?? "") as FeedbackType;
  const message = String(formData.get("message") ?? "").trim();
  const pageUrl = String(formData.get("page_url") ?? "").trim() || null;

  if (!VALID_TYPES.includes(type)) {
    redirectWithError("/about", t("invalidFeedbackType"), locale);
  }
  if (message.length < MIN_LENGTH) {
    redirectWithError(
      "/about",
      t("messageTooShort", { min: MIN_LENGTH }),
      locale,
    );
  }
  if (message.length > MAX_LENGTH) {
    redirectWithError(
      "/about",
      t("messageTooLong", { max: MAX_LENGTH }),
      locale,
    );
  }

  const { supabase, user } = await requireUser();

  // Gate por mínimo de participaciones — defense in depth, la UI ya esconde
  // el form pero un cliente malicioso podría postear el formulario igual.
  const entryCount = await countMyMatchEntries(supabase, user.id);
  if (entryCount < FEEDBACK_MIN_ENTRIES) {
    redirectWithError(
      "/about",
      t("needsParticipations", { min: FEEDBACK_MIN_ENTRIES }),
      locale,
    );
  }

  const { error } = await createFeedback(supabase, user.id, {
    type,
    message,
    pageUrl,
  });

  if (error) {
    redirectWithError(
      "/about",
      t("feedbackFailed", { error }),
      locale,
    );
  }

  revalidatePath("/about");
  redirect({ href: { pathname: "/about", query: { sent: "1" } }, locale });
}
