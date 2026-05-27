"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { CalendarClock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import { importHtml, type ImportFormState } from "./actions";

const INITIAL_STATE: ImportFormState = { status: "idle" };

interface ImportFormProps {
  /** True si en esta vista ya estamos mostrando el resultado de un import previo. */
  hasPreviousResult?: boolean;
}

/**
 * Form de importación.
 *
 * Flujo normal (HTML / CSV / PDF WinMSS): un solo submit — el server action
 * parsea, importa y redirige con el resultado.
 *
 * Flujo de los rankings PDF de la FAT: como ese formato no trae la fecha
 * del torneo, el server action devuelve estado `needsDate` y el form pasa
 * a un segundo paso donde el usuario completa la fecha (y puede corregir el
 * nombre) antes de confirmar. Se maneja con `useActionState`: el
 * `ParsedMatch` ya parseado viaja en el estado, así no hay que volver a
 * subir ni a parsear el archivo.
 */
export function ImportForm({ hasPreviousResult }: ImportFormProps) {
  const [state, formAction, pending] = useActionState(
    importHtml,
    INITIAL_STATE,
  );

  return (
    <Card className="p-6">
      <form action={formAction}>
        {state.status === "needsDate" ? (
          <NeedsDateBody state={state} pending={pending} />
        ) : (
          <UploadBody
            hasPreviousResult={!!hasPreviousResult}
            pending={pending}
          />
        )}
      </form>
    </Card>
  );
}

/**
 * Paso 1: elegir el archivo a importar.
 *
 * El input file nativo está oculto: usamos un botón + nombre de archivo
 * propios para mantener la UI 100% en español (el "Choose File" /
 * "No file chosen" del browser depende del locale del sistema y no se
 * puede traducir vía atributo).
 */
function UploadBody({
  hasPreviousResult,
  pending,
}: {
  hasPreviousResult: boolean;
  pending: boolean;
}) {
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
            accept=".html,.htm,.csv,.pdf"
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

      {/*
        Disparos mínimos del match (issue #75). Opcional acá: para FBI el
        importer aplica 45 automáticamente; para IPSC/Steel/Combat el
        admin lo completa al importar (si lo sabe) o después desde el
        detalle del match. Sin valor no rompe nada — el match queda sin
        métrica de eficiencia hasta que se complete.
      */}
      <Input
        label="Disparos mínimos del match"
        name="min_shots"
        type="number"
        min={1}
        step={1}
        placeholder="Ej. 90"
        hint="Opcional. Tiro FBI se asigna en 45 automáticamente. Para IPSC, Steel Challenge y Combat Solutions ingresá el mínimo de disparos por entry. Se usa para mostrar 'disparos extra' en el detalle y promediar la eficiencia del tirador."
      />

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

/**
 * Paso 2: completar la fecha de un ranking PDF de la FAT.
 *
 * El archivo ya se parseó OK; el `ParsedMatch` viaja en el estado del form.
 * Solo falta la fecha del torneo (ese formato no la incluye) y, opcional,
 * un ajuste del nombre — que se deriva del nombre del archivo.
 */
function NeedsDateBody({
  state,
  pending,
}: {
  state: Extract<ImportFormState, { status: "needsDate" }>;
  pending: boolean;
}) {
  return (
    <fieldset disabled={pending} className="space-y-5 disabled:opacity-60">
      <div className="flex items-start gap-3 rounded-md border border-accent/30 bg-accent-soft px-4 py-3">
        <CalendarClock
          className="mt-0.5 h-4 w-4 shrink-0 text-accent"
          aria-hidden
        />
        <div className="text-sm text-fg-muted">
          <p className="font-medium text-fg">Falta la fecha del torneo</p>
          <p className="mt-0.5">
            Los rankings oficiales de la FAT no incluyen la fecha. Leímos{" "}
            <strong className="text-fg">
              {state.entriesCount} resultado{state.entriesCount === 1 ? "" : "s"}
            </strong>{" "}
            de {state.disciplineLabel}
            {state.divisions.length > 0 && ` (${state.divisions.join(" / ")})`}.
            Completá los datos para terminar la importación.
          </p>
        </div>
      </div>

      {state.error && (
        <Alert tone="danger" title="No se pudo importar">
          {state.error}
        </Alert>
      )}

      <Input
        label="Nombre del torneo"
        name="name"
        type="text"
        defaultValue={state.parsed.name}
        required
      />

      <Input
        label="Fecha del torneo"
        name="date"
        type="date"
        required
        hint="No figura en el archivo de la FAT — indicá la fecha en que se corrió el match."
      />

      <div className="flex gap-3">
        <Button type="submit" className="flex-1" aria-busy={pending}>
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Importando...
            </>
          ) : (
            "Confirmar e importar"
          )}
        </Button>
        <Link
          href="/import"
          className={cn(
            "inline-flex h-10 shrink-0 items-center justify-center rounded-md px-4 text-sm font-medium",
            "border border-border bg-surface-2 text-fg-muted transition-colors",
            "hover:border-border-strong hover:bg-surface hover:text-fg",
            pending && "pointer-events-none opacity-50",
          )}
        >
          Cancelar
        </Link>
      </div>
    </fieldset>
  );
}
