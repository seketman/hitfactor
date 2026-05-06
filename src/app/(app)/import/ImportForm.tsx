"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import { importHtml } from "./actions";

interface ImportFormProps {
  /** True si en esta vista ya estamos mostrando el resultado de un import previo. */
  hasPreviousResult?: boolean;
}

/**
 * Form de importación con feedback visual claro:
 *  - Mientras el server action está corriendo, el fieldset entero queda deshabilitado.
 *  - El botón cambia de "Importar" a "Importando..." con spinner.
 *  - Después de un import exitoso, el label pasa a "Importar otro archivo".
 *
 * El reseteo del input file se hace por el `key` que pasa la página (que cambia
 * en cada nuevo resultado).
 */
export function ImportForm({ hasPreviousResult }: ImportFormProps) {
  return (
    <Card className="p-6">
      <form action={importHtml}>
        <FormBody hasPreviousResult={!!hasPreviousResult} />
      </form>
    </Card>
  );
}

function FormBody({ hasPreviousResult }: { hasPreviousResult: boolean }) {
  const { pending } = useFormStatus();

  const buttonLabel = pending
    ? "Importando..."
    : hasPreviousResult
      ? "Importar otro archivo"
      : "Importar";

  return (
    <fieldset disabled={pending} className="space-y-6 disabled:opacity-60">
      <label className="block">
        <span className="mb-1.5 flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wider text-fg-muted">
          <span>Archivo HTML</span>
          {pending && (
            <span className="inline-flex items-center gap-1 text-accent normal-case tracking-normal">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Procesando archivo…
            </span>
          )}
        </span>
        <input
          type="file"
          name="file"
          accept=".html,.htm"
          required
          aria-busy={pending}
          className={cn(
            "block w-full rounded-md border border-border bg-surface-2 text-sm text-fg",
            "file:mr-4 file:border-0 file:bg-accent file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-bg",
            pending
              ? "cursor-not-allowed file:cursor-not-allowed"
              : "cursor-pointer hover:file:bg-accent-strong",
          )}
        />
      </label>

      <Button type="submit" className="w-full" aria-busy={pending}>
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {buttonLabel}
          </>
        ) : (
          buttonLabel
        )}
      </Button>

      {pending && (
        <p className="text-center text-xs text-fg-subtle">
          No cierres la pestaña hasta que termine.
        </p>
      )}
    </fieldset>
  );
}
