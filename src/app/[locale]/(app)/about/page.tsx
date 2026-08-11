import { getLocale, getTranslations } from "next-intl/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { FeedbackForm } from "@/components/FeedbackForm";
import { LaPlataLink } from "@/components/LaPlataLink";
import { requireUser } from "@/lib/supabase/require-user";
import { FEEDBACK_MIN_ENTRIES, listMyFeedback } from "@/lib/db/feedback";
import { countMyMatchEntries } from "@/lib/db/shooters";
import type { FeedbackStatus, FeedbackType } from "@/lib/db/types";
import { formatDateTime } from "@/lib/utils";
import { getRequestTimeZone } from "@/lib/timezone";

interface PageProps {
  searchParams: Promise<{ sent?: string; error?: string }>;
}

/** Traductor del namespace `about`, inyectado en vez de importado. */
type AboutT = Awaited<ReturnType<typeof getTranslations<"about">>>;

/**
 * Un `switch` con las claves escritas, y no una tabla `type → clave`.
 *
 * `t(TYPE_KEYS[type])` funciona igual, pero la clave deja de ser un literal
 * y con eso desaparece de `tests/translation-keys.test.ts`, que empareja por
 * texto: un typo en la tabla no lo agarraría nadie y saldría
 * `about.typeBgu` impreso en pantalla. Mismo motivo por el que los códigos
 * de `ImportError` se tiran literales (#203).
 */
function getTypeLabel(t: AboutT, type: FeedbackType): string {
  switch (type) {
    case "bug":
      return t("typeBug");
    case "suggestion":
      return t("typeSuggestion");
    case "other":
      return t("typeOther");
  }
}

/**
 * `done` y `wontdo` dependen también del tipo: un bug se resuelve, una
 * sugerencia se implementa o se rechaza. Antes eran una tabla 2D de prosa;
 * ahora la variación vive en el mensaje, con un `select` de ICU sobre
 * `type`. Eso deja que cada idioma decida si la distinción existe y con qué
 * palabras — en inglés también existe ("Fixed" vs "Implemented"), pero una
 * tabla en español no tenía forma de expresarlo.
 */
function getStatusLabel(
  t: AboutT,
  status: FeedbackStatus,
  type: FeedbackType,
): string {
  switch (status) {
    case "done":
      return t("statusDone", { type });
    case "wontdo":
      return t("statusWontdo", { type });
    case "new":
      return t("statusNew");
    case "triaged":
      return t("statusTriaged");
    case "in_progress":
      return t("statusInProgress");
    case "duplicate":
      return t("statusDuplicate");
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
  const locale = await getLocale();
  const t = await getTranslations("about");
  const timeZone = await getRequestTimeZone();
  const { sent, error } = await searchParams;
  const { supabase, user } = await requireUser();
  const [myReports, entryCount] = await Promise.all([
    listMyFeedback(supabase, user.id),
    countMyMatchEntries(supabase, user.id),
  ]);
  const canSubmit = entryCount >= FEEDBACK_MIN_ENTRIES;

  return (
    <PageContainer className="max-w-3xl">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("title")}
        </h1>
      </header>

      <Card className="mb-8 px-6 py-6">
        <p className="text-sm leading-relaxed text-fg-muted">{t("intro")}</p>
        <p className="mt-4 text-sm leading-relaxed text-fg-muted">
          {t.rich("credits", {
            author: (c) => <span className="font-medium text-fg">{c}</span>,
            city: (c) => <LaPlataLink>{c}</LaPlataLink>,
            claude: (c) => (
              <a
                href="https://claude.com/claude-code"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                {c}
              </a>
            ),
          })}
        </p>
      </Card>

      <section className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight">
          {t("feedbackHeading")}
        </h2>
        <p className="mt-1 text-sm text-fg-muted">{t("feedbackIntro")}</p>
      </section>

      {sent === "1" && (
        <Alert tone="success" className="mb-6" title={t("sentTitle")}>
          {t("sentBody")}
        </Alert>
      )}

      {error && (
        <Alert tone="danger" className="mb-6">
          {error}
        </Alert>
      )}

      {canSubmit ? (
        <Card className="mb-10 px-6 py-6">
          <FeedbackForm />
        </Card>
      ) : (
        <Card className="mb-10 px-6 py-6">
          <p className="text-sm font-medium">{t("gateHeading")}</p>
          <p className="mt-2 text-sm text-fg-muted">
            {t.rich("gateBody", {
              count: FEEDBACK_MIN_ENTRIES,
              strong: (c) => <span className="font-medium text-fg">{c}</span>,
            })}
          </p>
          {/* Dos mensajes y no uno: "importá tu primero" no es el caso
              cero de un plural, es otra instrucción. Lo que falta sí es un
              plural, y lo resuelve ICU en vez de un ternario anidado que
              en inglés no funcionaría. */}
          <p className="mt-3 text-xs text-fg-subtle">
            {t.rich("gateProgress", {
              count: entryCount,
              total: FEEDBACK_MIN_ENTRIES,
              strong: (c) => (
                <span className="font-mono font-medium text-fg">{c}</span>
              ),
            })}{" "}
            {entryCount === 0
              ? t("gateNone")
              : t("gateRemaining", { count: FEEDBACK_MIN_ENTRIES - entryCount })}
          </p>
        </Card>
      )}

      {myReports.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-fg-muted">
            {t("reportsHeading")}
          </h2>
          <Card>
            <ul className="divide-y divide-border">
              {myReports.map((r) => (
                <li key={r.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="rounded-md bg-surface-2 px-2 py-0.5 font-medium text-fg-muted">
                        {getTypeLabel(t, r.type)}
                      </span>
                      <StatusBadge t={t} status={r.status} type={r.type} />
                    </div>
                    <span className="font-mono text-xs text-fg-subtle">
                      {formatDateTime(r.created_at, locale, timeZone)}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-fg">
                    {r.message}
                  </p>
                  {r.admin_note && (
                    <p className="mt-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-fg-muted">
                      <span className="font-medium text-fg">
                        {t("adminReply")}
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
  t,
  status,
  type,
}: {
  t: AboutT;
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
      {getStatusLabel(t, status, type)}
    </span>
  );
}
