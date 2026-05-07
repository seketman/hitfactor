"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
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

      <Select label="Tipo" name="type" defaultValue="bug" required>
        <option value="bug">Bug — algo no funciona como esperaba</option>
        <option value="suggestion">Sugerencia — idea para mejorar</option>
        <option value="other">Otro</option>
      </Select>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-fg-muted">
          Mensaje
        </span>
        <textarea
          name="message"
          required
          minLength={MIN_LENGTH}
          maxLength={MAX_LENGTH}
          rows={6}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Contame qué pasó, qué esperabas que pasara, o qué te gustaría que mejoremos. Si es un bug, sumá los pasos para reproducirlo por favor."
          className="block w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        <span className="mt-1 flex items-center justify-between text-xs text-fg-subtle">
          <span>
            {tooShort
              ? `Faltan ${MIN_LENGTH - message.trim().length} caracteres`
              : `Mínimo ${MIN_LENGTH} caracteres`}
          </span>
          <span>
            {message.length}/{MAX_LENGTH}
          </span>
        </span>
      </label>

      {pageUrl && (
        <p className="text-xs text-fg-subtle">
          Vas a incluir la página de referencia:{" "}
          <code className="font-mono">{pageUrl}</code>
        </p>
      )}

      <SubmitButton disabled={tooShort || message.trim().length < MIN_LENGTH} />
    </form>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} aria-busy={pending}>
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Enviando…
        </>
      ) : (
        "Enviar reporte"
      )}
    </Button>
  );
}
