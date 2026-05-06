"use client";

import { useState } from "react";
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
 * El input file nativo está oculto: usamos un botón + nombre de archivo
 * propios para mantener la UI 100% en español (el "Choose File" /
 * "No file chosen" del browser depende del locale del sistema y no se
 * puede traducir vía atributo).
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
  const [filename, setFilename] = useState<string | null>(null);

  const buttonLabel = pending
    ? "Importando..."
    : hasPreviousResult
      ? "Importar otro archivo"
      : "Importar";

  return (
    <fieldset disabled={pending} className="space-y-6 disabled:opacity-60">
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wider text-fg-muted">
          <span>Archivo a importar</span>
          {pending && (
            <span className="inline-flex items-center gap-1 text-accent normal-case tracking-normal">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Procesando archivo…
            </span>
          )}
        </div>

        <label
          className={cn(
            "flex items-center gap-3 rounded-md border border-border bg-surface-2 p-1 pr-3",
            pending ? "cursor-not-allowed" : "cursor-pointer",
          )}
        >
          <input
            type="file"
            name="file"
            accept=".html,.htm,.csv"
            required
            aria-busy={pending}
            onChange={(e) => setFilename(e.target.files?.[0]?.name ?? null)}
            className="sr-only"
          />
          <span
            className={cn(
              "rounded-sm bg-accent px-4 py-2 text-sm font-medium text-bg",
              !pending && "hover:bg-accent-strong",
            )}
          >
            Elegir archivo
          </span>
          <span
            className={cn(
              "truncate text-sm",
              filename ? "text-fg" : "text-fg-subtle",
            )}
          >
            {filename ?? "Ningún archivo seleccionado"}
          </span>
        </label>
      </div>

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
