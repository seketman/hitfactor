"use client";

import { useActionState, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { CalendarClock, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import {
  ImportUploadError,
  uploadImportFiles,
} from "@/lib/import/upload-to-storage";
import { importHtml, type ImportFormState } from "./actions";

const INITIAL_STATE: ImportFormState = { status: "idle" };

/**
 * Acción del form: sube los archivos a Storage y recién ahí llama al
 * server action con las referencias.
 *
 * El upload va del browser directo al bucket, sin pasar por la Function
 * de Vercel — que corta cualquier body de más de 4.5 MB y hacía fallar
 * los PDFs de stages WinMSS con un 413. Ver `@/lib/import/upload-to-storage`.
 *
 * Es una función cliente envolviendo un server action, así que el
 * `pending` de `useActionState` cubre las dos etapas: mientras sube y
 * mientras importa el usuario ve el mismo spinner.
 */
async function uploadThenImport(
  prevState: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  // Segundo submit del flujo FAT: no hay archivos nuevos que subir, el
  // `ParsedMatch` ya viaja en el estado. Va derecho al server action.
  if (prevState.status === "needsDate") {
    return importHtml(prevState, formData);
  }

  const files = formData
    .getAll("file")
    .filter((f): f is File => f instanceof File && f.size > 0);

  // Sacamos los binarios del FormData: lo único que cruza al server son
  // las referencias `{ path, filename }` del bucket.
  formData.delete("file");

  try {
    for (const uploaded of await uploadImportFiles(files)) {
      formData.append("upload", JSON.stringify(uploaded));
    }
  } catch (e) {
    if (e instanceof ImportUploadError) {
      return { status: "uploadFailed", code: e.code, filename: e.filename };
    }
    throw e;
  }

  return importHtml(prevState, formData);
}

interface ImportFormProps {
  /** True si en esta vista ya estamos mostrando el resultado de un import previo. */
  hasPreviousResult?: boolean;
  /**
   * Nombre del archivo que el usuario intentó subir en el intento anterior
   * que terminó en error. Se muestra como hint para que tenga contexto
   * de qué falló y pueda re-elegirlo. Null en flujos OK / primer uso.
   */
  lastFile?: string | null;
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
export function ImportForm({ hasPreviousResult, lastFile }: ImportFormProps) {
  const [state, formAction, pending] = useActionState(
    uploadThenImport,
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
            lastFile={lastFile ?? null}
            pending={pending}
            uploadError={state.status === "uploadFailed" ? state : null}
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
  lastFile,
  pending,
  uploadError,
}: {
  hasPreviousResult: boolean;
  lastFile: string | null;
  pending: boolean;
  uploadError: Extract<ImportFormState, { status: "uploadFailed" }> | null;
}) {
  // `multiple` para soportar Steel Challenge (un PDF por stage). Para el
  // resto de los formatos un solo archivo alcanza — el server action
  // distingue por cantidad y branchea al parser correspondiente.
  const t = useTranslations("import.form");
  const [files, setFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const pickerLabel = hasPreviousResult ? t("pickOther") : t("pick");
  const hasFiles = files.length > 0;
  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);

  function clearFiles() {
    setFiles([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <fieldset disabled={pending} className="space-y-6 disabled:opacity-60">
      {/*
        El upload a Storage falló, así que el import ni se intentó. Va
        acá dentro y no por el querystring como los errores del server
        action: nunca hubo navegación, seguimos en el mismo render.
      */}
      {uploadError && (
        <Alert tone="danger" title={t("uploadErrorTitle")}>
          {t(`uploadError.${uploadError.code}`)}
          {uploadError.filename && (
            <span className="font-mono"> ({uploadError.filename})</span>
          )}
        </Alert>
      )}

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wider text-fg-muted">
          <span>{t("filesToImport")}</span>
          {pending && (
            <span className="inline-flex items-center gap-1 text-accent normal-case tracking-normal">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              {t("processing", { count: files.length })}
            </span>
          )}
        </div>

        <label
          className={cn(
            "flex items-center gap-3 rounded-md border border-border bg-surface-2 p-1 pr-1",
            pending ? "cursor-not-allowed" : "cursor-pointer",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            name="file"
            accept=".html,.htm,.csv,.pdf"
            multiple
            required
            aria-busy={pending}
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="sr-only"
          />
          <span
            className={cn(
              "rounded-sm bg-accent px-4 py-2 text-sm font-medium text-bg",
              !pending && "hover:bg-accent-strong",
            )}
          >
            {pickerLabel}
          </span>
          <span
            className={cn(
              "flex-1 truncate text-sm",
              hasFiles ? "text-fg" : "text-fg-subtle",
            )}
          >
            {files.length === 0 && t("noFileSelected")}
            {files.length === 1 &&
              `${files[0]!.name} · ${formatBytes(files[0]!.size)}`}
            {files.length > 1 &&
              t("filesCount", {
                count: files.length,
                size: formatBytes(totalBytes),
              })}
          </span>
          {hasFiles && !pending && (
            <button
              type="button"
              onClick={(e) => {
                // Evita que el click se propague al <label> y abra el picker.
                e.preventDefault();
                e.stopPropagation();
                clearFiles();
              }}
              aria-label={t("removeFiles")}
              title={t("removeFilesShort")}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-surface hover:text-fg"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </label>

        {/*
          Si el usuario eligió varios archivos, mostramos la lista compacta
          debajo del label para que pueda chequear que están los que quiso.
          No agregamos un ✕ por archivo: si se equivocó, vuelve a elegir.
        */}
        {files.length > 1 && (
          <ul className="mt-2 space-y-0.5 text-xs text-fg-subtle">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="truncate">
                · {f.name} <span className="text-fg-muted">({formatBytes(f.size)})</span>
              </li>
            ))}
          </ul>
        )}

        {/*
          Hint cuando el intento anterior falló: le decimos al user qué
          archivo (o resumen "N archivos") intentó subir antes para que
          tenga contexto al re-elegir. Solo aparece si NO hay archivos
          recién seleccionados.
        */}
        {lastFile && !hasFiles && (
          <p className="mt-1.5 text-xs text-fg-subtle">
            {t("lastAttempt")}{" "}
            <span className="font-mono text-fg-muted">{lastFile}</span>.{" "}
            {t("lastAttemptHint")}
          </p>
        )}
      </div>

      {/*
        Disparos mínimos del match (issue #75). Opcional acá: para FBI el
        importer aplica 45 automáticamente; para IPSC/Steel/Combat el
        admin lo completa al importar (si lo sabe) o después desde el
        detalle del match. Sin valor no rompe nada — el match queda sin
        métrica de eficiencia hasta que se complete.
      */}
      <Input
        label={t("minShotsLabel")}
        name="min_shots"
        type="number"
        min={1}
        step={1}
        placeholder={t("minShotsPlaceholder")}
        hint={t("minShotsHint")}
      />

      <Button
        type="submit"
        className="w-full"
        aria-busy={pending}
        disabled={!hasFiles}
      >
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("importing")}
          </>
        ) : (
          t("import")
        )}
      </Button>

      {pending && (
        <p className="text-center text-xs text-fg-subtle">
          {t("dontClose")}
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
  const t = useTranslations("import.form");
  return (
    <fieldset disabled={pending} className="space-y-5 disabled:opacity-60">
      <div className="flex items-start gap-3 rounded-md border border-accent/30 bg-accent-soft px-4 py-3">
        <CalendarClock
          className="mt-0.5 h-4 w-4 shrink-0 text-accent"
          aria-hidden
        />
        <div className="text-sm text-fg-muted">
          <p className="font-medium text-fg">{t("needsDateTitle")}</p>
          <p className="mt-0.5">
            {t("needsDateBodyBefore")}{" "}
            <strong className="text-fg">
              {t("needsDateEntries", { count: state.entriesCount })}
            </strong>{" "}
            {t("needsDateOf", { label: state.disciplineLabel })}
            {state.divisions.length > 0 && ` (${state.divisions.join(" / ")})`}.{" "}
            {t("needsDateComplete")}
          </p>
        </div>
      </div>

      {state.error && (
        <Alert tone="danger" title={t("errorTitle")}>
          {state.error}
        </Alert>
      )}

      <Input
        label={t("nameLabel")}
        name="name"
        type="text"
        defaultValue={state.parsed.name}
        required
      />

      <Input
        label={t("dateLabel")}
        name="date"
        type="date"
        required
        hint={t("dateHint")}
      />

      <div className="flex gap-3">
        <Button type="submit" className="flex-1" aria-busy={pending}>
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t("importing")}
            </>
          ) : (
            t("confirmImport")
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
          {t("cancel")}
        </Link>
      </div>
    </fieldset>
  );
}

/** Formatea bytes a "12 B" / "3.4 KB" / "1.2 MB" para mostrar al usuario. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}
