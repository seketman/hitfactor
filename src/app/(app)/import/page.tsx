import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { createClient } from "@/lib/supabase/server";
import { findClaimCandidates } from "@/lib/import/match-claim";
import { claimShooter } from "@/lib/actions/claim";
import { importHtml } from "./actions";

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
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
        <h1 className="text-2xl font-semibold tracking-tight">Importar resultados</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Subí un archivo HTML exportado de PractiScore. Empezá por el archivo de
          Match Results y después agregá los stages uno por uno.
        </p>
      </header>

      {params.error && (
        <Alert tone="danger" title="No se pudo importar" className="mb-6">
          {params.error}
        </Alert>
      )}

      {params.ok === "1" && (
        <Alert tone="success" title={`Importado: ${params.name}`} className="mb-6">
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {params.discipline && (
              <li>
                Disciplina: <strong className="text-fg">{params.discipline}</strong>
              </li>
            )}
            {params.entries && Number(params.entries) > 0 && (
              <li>{params.entries} resultados de tiradores</li>
            )}
            {params.stages && Number(params.stages) > 0 && (
              <li>{params.stages} stage(s) nuevos</li>
            )}
            {params.stageResults && Number(params.stageResults) > 0 && (
              <li>{params.stageResults} resultados de stages</li>
            )}
            {params.existed === "1" && (
              <li>El match ya existía — solo se agregaron stages.</li>
            )}
          </ul>
        </Alert>
      )}

      {candidates.length > 0 && params.matchId && (
        <Card className="mb-6 border-accent/30 bg-accent-soft">
          <div className="px-5 py-4">
            <h2 className="text-sm font-medium text-accent">
              ¿Sos alguno de estos tiradores?
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              Detectamos {candidates.length === 1 ? "una coincidencia" : `${candidates.length} coincidencias`}
              {" "}entre los participantes y tu perfil. Linkealos para ver tu performance.
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
                      coincidencia por {c.reason === "member_number" ? "número de socio" : "nombre"}
                    </span>
                  </p>
                </div>
                <form action={claimShooter}>
                  <input type="hidden" name="shooter_id" value={c.shooterId} />
                  <input type="hidden" name="match_id" value={params.matchId} />
                  <input type="hidden" name="redirect_to" value="/dashboard" />
                  <Button type="submit" size="sm">
                    Soy yo
                  </Button>
                </form>
              </li>
            ))}
          </ul>
          <div className="border-t border-border px-5 py-3 text-xs text-fg-subtle">
            ¿Ninguno?{" "}
            <Link
              href={`/matches/${params.matchId}`}
              className="text-accent hover:underline"
            >
              Buscalo manualmente en el ranking
            </Link>
            .
          </div>
        </Card>
      )}

      <Card className="p-6">
        <form action={importHtml}>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-fg-muted">
              Archivo HTML
            </span>
            <input
              type="file"
              name="file"
              accept=".html,.htm"
              required
              className="block w-full cursor-pointer rounded-md border border-border bg-surface-2 text-sm text-fg file:mr-4 file:border-0 file:bg-accent file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-bg hover:file:bg-accent-strong"
            />
          </label>
          <Button type="submit" className="mt-6 w-full">
            Importar
          </Button>
        </form>
      </Card>

      <details className="mt-6 text-sm text-fg-muted">
        <summary className="cursor-pointer hover:text-fg">
          ¿Qué archivos puedo subir?
        </summary>
        <div className="mt-3 space-y-2 pl-4">
          <p>
            <strong className="text-fg">Match Results — Combined</strong>: ranking
            general de todas las divisiones en un único archivo.
          </p>
          <p>
            <strong className="text-fg">Match Results — por división</strong>:
            ranking del torneo, separado en bloques por división.
          </p>
          <p>
            <strong className="text-fg">Stage Results</strong>: resultados de un
            stage individual. Subilos después de haber importado el match overall.
          </p>
        </div>
      </details>
    </PageContainer>
  );
}
