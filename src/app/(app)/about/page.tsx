import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { FeedbackForm } from "@/components/FeedbackForm";
import { requireUser } from "@/lib/supabase/require-user";
import { listMyFeedback } from "@/lib/db/feedback";
import type { FeedbackStatus, FeedbackType } from "@/lib/db/types";
import { formatDateTime } from "@/lib/utils";

interface PageProps {
  searchParams: Promise<{ sent?: string; error?: string }>;
}

const TYPE_LABELS: Record<FeedbackType, string> = {
  bug: "Bug",
  suggestion: "Sugerencia",
  other: "Otro",
};

// Status `done` y `wontdo` cambian de label según el tipo: un bug se "resuelve"
// pero una sugerencia se "implementa" o se "rechaza". `duplicate` aplica a todos.
const TERMINAL_LABELS_BY_TYPE: Record<
  "done" | "wontdo",
  Record<FeedbackType, string>
> = {
  done: {
    bug: "Resuelto",
    suggestion: "Implementada",
    other: "Resuelto",
  },
  wontdo: {
    bug: "No se va a resolver",
    suggestion: "Rechazada",
    other: "Descartado",
  },
};

function getStatusLabel(status: FeedbackStatus, type: FeedbackType): string {
  if (status === "done" || status === "wontdo") {
    return TERMINAL_LABELS_BY_TYPE[status][type];
  }
  switch (status) {
    case "new":
      return "Nuevo";
    case "triaged":
      return "En revisión";
    case "in_progress":
      return "En progreso";
    case "duplicate":
      return "Duplicado";
  }
}

const STATUS_TONE: Record<
  FeedbackStatus,
  "info" | "success" | "warning" | "danger"
> = {
  new: "info",
  triaged: "info",
  in_progress: "warning",
  done: "success",
  wontdo: "danger",
  duplicate: "info",
};

export default async function AboutPage({ searchParams }: PageProps) {
  const { sent, error } = await searchParams;
  const { supabase, user } = await requireUser();
  const myReports = await listMyFeedback(supabase, user.id);

  return (
    <PageContainer className="max-w-3xl">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Acerca de HitFactor
        </h1>
      </header>

      <Card className="mb-8 px-6 py-6">
        <p className="text-sm leading-relaxed text-fg-muted">
          HitFactor es una herramienta gratuita para tiradores que quieren
          llevar el seguimiento de sus resultados en torneos. Importás la
          planilla del match y te quedás con tu historial, estadísticas y
          progreso por disciplina.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-fg-muted">
          Creado por <span className="font-medium text-fg">Seketman</span>, un
          tirador novato de La Plata, con la ayuda invaluable de{" "}
          <a
            href="https://claude.com/claude-code"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            Claude
          </a>
          .
        </p>
      </Card>

      <section className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight">
          ¿Encontraste un bug? ¿Tenés una idea?
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Contame qué pasó o qué te gustaría que mejoremos. Lo voy a sumar al
          backlog y, si te interesa, podés ver acá abajo el estado de lo que
          ya reportaste.
        </p>
      </section>

      {sent === "1" && (
        <Alert tone="success" className="mb-6" title="¡Gracias!">
          Tu reporte llegó. Lo voy a revisar pronto y vas a ver el estado en
          la lista de abajo.
        </Alert>
      )}

      {error && (
        <Alert tone="danger" className="mb-6">
          {error}
        </Alert>
      )}

      <Card className="mb-10 px-6 py-6">
        <FeedbackForm />
      </Card>

      {myReports.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-fg-muted">
            Tus reportes anteriores
          </h2>
          <Card>
            <ul className="divide-y divide-border">
              {myReports.map((r) => (
                <li key={r.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="rounded-md bg-surface-2 px-2 py-0.5 font-medium text-fg-muted">
                        {TYPE_LABELS[r.type]}
                      </span>
                      <StatusBadge status={r.status} type={r.type} />
                    </div>
                    <span className="font-mono text-xs text-fg-subtle">
                      {formatDateTime(r.created_at)}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-fg">
                    {r.message}
                  </p>
                  {r.admin_note && (
                    <p className="mt-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-fg-muted">
                      <span className="font-medium text-fg">
                        Respuesta de Seketman:
                      </span>{" "}
                      {r.admin_note}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </PageContainer>
  );
}

function StatusBadge({
  status,
  type,
}: {
  status: FeedbackStatus;
  type: FeedbackType;
}) {
  const tone = STATUS_TONE[status];
  const toneClass: Record<typeof tone, string> = {
    info: "bg-info/10 text-info",
    success: "bg-success/10 text-success",
    warning: "bg-accent-soft text-accent",
    danger: "bg-danger/10 text-danger",
  };
  return (
    <span
      className={`rounded-md px-2 py-0.5 text-xs font-medium ${toneClass[tone]}`}
    >
      {getStatusLabel(status, type)}
    </span>
  );
}
