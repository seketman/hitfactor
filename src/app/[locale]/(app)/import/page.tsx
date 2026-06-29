import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Users } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { createClient } from "@/lib/supabase/server";
import { findClaimCandidates } from "@/lib/import/match-claim";
import { claimShooter } from "@/lib/actions/claim";
import { DismissOnSubmit } from "./DismissOnSubmit";
import { ImportForm } from "./ImportForm";

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    /**
     * Nombre del archivo que el usuario intentó subir en el intento que
     * terminó en error. La server action lo agrega a la URL via
     * `redirectImportError` para que el form remontado pueda mostrar
     * "Último intento: X" como contexto al usuario.
     */
    lastFile?: string;
    ok?: string;
    matchId?: string;
    name?: string;
    discipline?: string;
    entries?: string;
    stages?: string;
    stageResults?: string;
    existed?: string;
  }>;
}) {
  const params = await searchParams;
  const t = await getTranslations("import");

  // Si vinimos de un import exitoso con matchId, buscamos candidatos a claim
  // (solo si el usuario aún no linkeó su shooter).
  let candidates: Awaited<ReturnType<typeof findClaimCandidates>> = [];
  if (params.ok === "1" && params.matchId) {
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) {
      candidates = await findClaimCandidates(
        supabase,
        userData.user.id,
        params.matchId,
      );
    }
  }

  return (
    <PageContainer className="max-w-2xl">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {t("subtitle")}
        </p>
      </header>

      <div className="mb-6 flex items-start gap-3 rounded-md border border-border bg-surface-2 px-4 py-3">
        <Users className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
        <p className="text-sm text-fg-muted">
          {t("sharedNoticeBefore")}{" "}
          <span className="font-medium text-fg">{t("sharedNoticeAllShooters")}</span>{" "}
          {t("sharedNoticeAfter")}{" "}
          <Link href="/matches" className="text-accent hover:underline">
            {t("searchInMatches")}
          </Link>{" "}
          {t("sharedNoticeEnd")}
        </p>
      </div>

      {(params.error || params.ok === "1") && (
        <DismissOnSubmit key={`alerts:${resultKey(params)}`}>
          {params.error && (
            <Alert tone="danger" title={t("errorTitle")} className="mb-6">
              {params.error}
            </Alert>
          )}
          {params.ok === "1" && (
            <Alert
              tone="success"
              title={t("importedTitle", { name: params.name ?? "" })}
              className="mb-6"
            >
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {params.discipline && (
                  <li>
                    {t("resultDiscipline")}{" "}
                    <strong className="text-fg">{params.discipline}</strong>
                  </li>
                )}
                {params.entries && Number(params.entries) > 0 && (
                  <li>{t("resultEntries", { count: Number(params.entries) })}</li>
                )}
                {params.stages && Number(params.stages) > 0 && (
                  <li>{t("resultStages", { count: Number(params.stages) })}</li>
                )}
                {params.stageResults && Number(params.stageResults) > 0 && (
                  <li>{t("resultStageResults", { count: Number(params.stageResults) })}</li>
                )}
                {params.existed === "1" && (
                  <li>{t("resultExisted")}</li>
                )}
              </ul>
            </Alert>
          )}
        </DismissOnSubmit>
      )}

      {candidates.length > 0 && params.matchId && (
        <Card className="mb-6 border-accent/30 bg-accent-soft">
          <div className="px-5 py-4">
            <h2 className="text-sm font-medium text-accent">
              {t("candidatesTitle")}
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              {t("candidatesBodyBefore")}{" "}
              {candidates.length === 1
                ? t("candidatesOne")
                : t("candidatesMany", { count: candidates.length })}{" "}
              {t("candidatesBodyAfter")}{" "}
              <span className="font-medium text-fg">{t("candidatesImYouQuoted")}</span>{" "}
              {t("candidatesBodyEnd")}
            </p>
          </div>
          <ul className="divide-y divide-border border-t border-border">
            {candidates.map((c) => (
              <li
                key={c.shooterId}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium">{c.fullName}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                    {c.divisionCode && <Badge>{c.divisionCode}</Badge>}
                    {c.memberNumber && <span>#{c.memberNumber}</span>}
                    <span className="text-fg-subtle">
                      {t("matchByPrefix", {
                        by:
                          c.reason === "member_number"
                            ? t("matchByMember")
                            : t("matchByName"),
                      })}
                    </span>
                  </p>
                </div>
                <form action={claimShooter}>
                  <input type="hidden" name="shooter_id" value={c.shooterId} />
                  <input type="hidden" name="match_id" value={params.matchId} />
                  <input type="hidden" name="redirect_to" value="/dashboard" />
                  <Button type="submit" size="sm">
                    {t("imYou")}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
          <div className="border-t border-border px-5 py-3 text-xs text-fg-subtle">
            {t("noneOfThem")}{" "}
            <Link
              href={`/matches/${params.matchId}`}
              className="text-accent hover:underline"
            >
              {t("searchManually")}
            </Link>
            .
          </div>
        </Card>
      )}

      {/*
        key cambia con cada nuevo resultado: fuerza remount del form y
        limpia el input file. Si no hay resultado, queda en "idle".
      */}
      <ImportForm
        key={resultKey(params)}
        hasPreviousResult={params.ok === "1" || Boolean(params.error)}
        lastFile={params.error ? params.lastFile ?? null : null}
      />

      <details className="mt-6 text-sm text-fg-muted">
        <summary className="cursor-pointer hover:text-fg">
          {t("whichFiles")}
        </summary>
        <div className="mt-3 space-y-2 pl-4">
          <p>
            <strong className="text-fg">{t("fileCombinedName")}</strong>
            {t("fileCombinedBody")}
          </p>
          <p>
            <strong className="text-fg">{t("fileByDivisionName")}</strong>
            {t("fileByDivisionBody")}
          </p>
          <p>
            <strong className="text-fg">{t("fileStageName")}</strong>
            {t("fileStageBody")}
          </p>
          <p>
            <strong className="text-fg">{t("fileCsvName")}</strong>
            {t("fileCsvBody")}
          </p>
          <p>
            <strong className="text-fg">{t("fileWinmssName")}</strong>
            {t("fileWinmssBody")}
          </p>
          <p>
            <strong className="text-fg">{t("fileFatName")}</strong>
            {t("fileFatBody")}
            <code>resultados-apertura-fbi.pdf</code>
            {t("fileFatBodyEnd")}
          </p>
          <p>
            <strong className="text-fg">{t("fileSteelName")}</strong>
            {t("fileSteelBody")}
          </p>
        </div>
      </details>
    </PageContainer>
  );
}

/**
 * Hash determinístico de los searchParams relevantes a la importación,
 * usado como `key` del ImportForm para forzar remount cuando hay un
 * resultado nuevo (y así limpiar el input file).
 */
function resultKey(params: {
  ok?: string;
  error?: string;
  matchId?: string;
  name?: string;
  entries?: string;
  stages?: string;
  stageResults?: string;
}): string {
  if (params.error) return `err:${params.error}`;
  if (params.ok === "1") {
    return `ok:${params.matchId ?? ""}:${params.entries ?? ""}:${params.stages ?? ""}:${params.stageResults ?? ""}`;
  }
  return "idle";
}
