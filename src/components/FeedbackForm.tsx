"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { submitFeedback } from "@/lib/actions/feedback";

const MIN_LENGTH = 10;
const MAX_LENGTH = 4000;

/**
 * Form de feedback en /about. Captura `page_url` desde `document.referrer`
 * (la página desde la que el usuario vino al about) — si no hay referrer
 * o es externo, queda vacío.
 */
export function FeedbackForm() {
  const t = useTranslations("about.form");
  const [message, setMessage] = useState("");
  const [pageUrl, setPageUrl] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ref = document.referrer;
    if (!ref) return;
    try {
      const url = new URL(ref);
      if (url.origin === window.location.origin) {
        setPageUrl(url.pathname + url.search);
      }
    } catch {
      // referrer inválido, ignoramos
    }
  }, []);

  const tooShort = message.trim().length > 0 && message.trim().length < MIN_LENGTH;

  return (
    <form action={submitFeedback} className="space-y-4">
      <input type="hidden" name="page_url" value={pageUrl} />

      <Select label={t("type")} name="type" defaultValue="bug" required>
        <option value="bug">{t("typeBugOption")}</option>
        <option value="suggestion">{t("typeSuggestionOption")}</option>
        <option value="other">{t("typeOtherOption")}</option>
      </Select>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-fg-muted">
          {t("message")}
        </span>
        <textarea
          name="message"
          required
          minLength={MIN_LENGTH}
          maxLength={MAX_LENGTH}
          rows={6}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t("messagePlaceholder")}
          className="block w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        <span className="mt-1 flex items-center justify-between text-xs text-fg-subtle">
          <span>
            {tooShort
              ? t("charsMissing", { count: MIN_LENGTH - message.trim().length })
              : t("charsMinimum", { count: MIN_LENGTH })}
          </span>
          <span>
            {message.length}/{MAX_LENGTH}
          </span>
        </span>
      </label>

      {pageUrl && (
        <p className="text-xs text-fg-subtle">
          {t("referrerNote")}{" "}
          <code className="font-mono">{pageUrl}</code>
        </p>
      )}

      <SubmitButton disabled={tooShort || message.trim().length < MIN_LENGTH} />
    </form>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const t = useTranslations("about.form");
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} aria-busy={pending}>
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t("submitting")}
        </>
      ) : (
        t("submit")
      )}
    </Button>
  );
}
