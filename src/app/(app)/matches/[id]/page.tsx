import Link from "next/link";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/Table";
import { requireUser } from "@/lib/supabase/require-user";
import { getProfile } from "@/lib/db/profiles";
import { listMyShooters } from "@/lib/db/shooters";
import { listClubs } from "@/lib/db/clubs";
import {
  getMatchById,
  listEntriesByMatch,
  listStagesByMatch,
} from "@/lib/db/matches";
import { buildClubLookup, getClubName, parseRegion } from "@/lib/clubs";
import {
  cn,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
} from "@/lib/utils";
import type { MatchEntryWithRelations } from "@/lib/db/types";
import { claimShooter } from "@/lib/actions/claim";
import { getMyClaimAliases, isClaimCandidate } from "@/lib/import/match-claim";
import { MatchActionsBar } from "@/components/MatchActionsBar";
import { isHitsBasedDiscipline } from "@/lib/disciplines";
import { isInternalAppPath } from "@/lib/redirects";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; from?: string }>;
}

export default async function MatchDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { error, from } = await searchParams;

  const { supabase, user } = await requireUser();
  const userId = user.id;

  const match = await getMatchById(supabase, id);
  if (!match) notFound();

  const [importerProfile, entries, stages, myShooters, clubs, claimAliases] =
    await Promise.all([
      getProfile(supabase, match.imported_by_user_id),
      listEntriesByMatch(supabase, id),
      listStagesByMatch(supabase, id),
      listMyShooters(supabase, userId),
      listClubs(supabase),
      getMyClaimAliases(supabase, userId),
    ]);

  const myShooterIds = new Set(myShooters.map((s) => s.id));
  const isImporter = match.imported_by_user_id === userId;
  const parsedClub = parseRegion(match.region);
  const clubLookup = buildClubLookup(clubs);
  const clubLabel =
    getClubName(match.region, clubLookup) ?? match.region ?? null;
  // Tiro FBI rankea por impactos antes que por puntos — agregamos columna
  // Impactos y bajamos el énfasis visual de Puntos en la tabla.
  const isHitsBased = isHitsBasedDiscipline(match.disciplines);

  // Agrupar por división
  const byDivision = new Map<string, MatchEntryWithRelations[]>();
  for (const e of entries) {
    const code = e.divisions?.code ?? "?";
    if (!byDivision.has(code)) byDivision.set(code, []);
    byDivision.get(code)!.push(e);
  }
  const sortedDivisions = Array.from(byDivision.keys()).sort();

  // Link de volver: prioriza la ruta de origen (?from=...) cuando es una
  // ruta interna válida — así devolvemos al usuario exactamente a la vista
  // que estaba mirando (matches, dashboard consolidado, o por disciplina).
  // Fallback: /matches, que es la grilla principal.
  const validFrom = isInternalAppPath(from) ? from : null;
  const backHref = validFrom ?? "/matches";

  return (
    <PageContainer>
      <Link
        href={backHref}
        className="mb-4 inline-block text-sm text-fg-muted hover:text-accent"
      >
        ← Volver a matches
      </Link>

      {error && (
        <Alert tone="danger" className="mb-6">
          {error}
        </Alert>
      )}

      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{match.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
            <span>{formatDate(match.date)}</span>
            {clubLabel && <span title={parsedClub.clubCode ?? undefined}>· {clubLabel}</span>}
            {match.disciplines?.name && <span>· {match.disciplines.name}</span>}
          </div>
          <p className="mt-2 text-xs text-fg-subtle">
            Importado por{" "}
            <span className="text-fg-muted">
              {importerProfile?.display_name ?? "—"}
            </span>{" "}
            el {formatDateTime(match.imported_at)}
          </p>
        </div>

        {isImporter && (
          <div className="w-full sm:w-auto sm:max-w-2xl sm:flex-1 sm:basis-auto">
            <MatchActionsBar
              matchId={match.id}
              currentRegion={match.region}
              currentClubCode={parsedClub.clubCode}
              clubs={clubs}
              from={validFrom ?? undefined}
            />
          </div>
        )}
      </header>

      {stages.length > 0 && (
        <Card className="mb-8 p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-muted">
            Stages cargados ({stages.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {stages.map((s) => (
              <Badge key={s.id}>Stage {s.stage_number}</Badge>
            ))}
          </div>
        </Card>
      )}

      {isHitsBased && (
        <p className="-mt-4 mb-6 text-xs text-fg-subtle">
          Ranking por <strong className="text-fg-muted">impactos</strong> (puntos como desempate).
        </p>
      )}

      {sortedDivisions.map((divCode) => {
        const list = byDivision.get(divCode)!;
        const divName = list[0].divisions?.name ?? divCode;
        return (
          <section key={divCode} className="mb-8">
            <h2 className="mb-3 text-lg font-semibold">
              {divName}{" "}
              <span className="text-sm font-normal text-fg-subtle">({divCode})</span>
            </h2>
            <Card className="overflow-hidden">
              <Table>
                <THead>
                  <TR>
                    <TH className="w-12">#</TH>
                    <TH>Tirador</TH>
                    <TH>Categoría</TH>
                    {isHitsBased && (
                      <TH className="text-right">Impactos</TH>
                    )}
                    <TH className="text-right">Puntos</TH>
                    <TH className="text-right">%</TH>
                    <TH className="w-28"></TH>
                  </TR>
                </THead>
                <TBody>
                  {list.map((e) => {
                    const shooter = e.shooters;
                    const isMine = !!shooter && myShooterIds.has(shooter.id);
                    // "Soy yo" aparece solo si:
                    //  - el shooter no está linkeado a nadie todavía,
                    //  - y el nombre tiene similitud razonable con alguno de
                    //    los aliases del usuario (profile + identidades ya
                    //    linkeadas). En el bootstrap (aliases pobres) no
                    //    filtramos para no bloquear el primer claim.
                    const canClaim =
                      !!shooter &&
                      shooter.linked_user_id === null &&
                      isClaimCandidate(shooter, claimAliases);
                    return (
                      <TR
                        key={e.id}
                        className={
                          isMine
                            ? "bg-accent-soft hover:bg-accent-soft"
                            : undefined
                        }
                      >
                        <TD className="text-fg-muted">
                          {e.is_dq ? <Badge tone="danger">DQ</Badge> : e.place}
                        </TD>
                        <TD>
                          <div className="flex items-center gap-2 font-medium">
                            {shooter?.full_name}
                            {isMine && <Badge tone="accent">vos</Badge>}
                          </div>
                          {shooter?.member_number && (
                            <div className="font-mono text-xs text-fg-subtle">
                              #{shooter.member_number}
                            </div>
                          )}
                        </TD>
                        <TD className="text-fg-muted">
                          {e.category ?? "—"}
                          {e.power_factor && (
                            <span className="ml-1 text-xs text-fg-subtle">
                              ({e.power_factor})
                            </span>
                          )}
                        </TD>
                        {isHitsBased && (
                          <TD className="text-right font-mono font-semibold text-fg">
                            {e.is_dq ? "—" : (e.hits ?? "—")}
                          </TD>
                        )}
                        <TD
                          className={cn(
                            "text-right font-mono",
                            isHitsBased && "text-fg-muted",
                          )}
                        >
                          {e.is_dq ? "—" : formatNumber(e.match_points, 2)}
                        </TD>
                        <TD
                          className={cn(
                            "text-right font-mono",
                            isHitsBased && "text-fg-muted",
                          )}
                        >
                          {e.is_dq ? "—" : formatPercent(e.match_percentage)}
                        </TD>
                        <TD>
                          {canClaim && (
                            <form action={claimShooter}>
                              <input
                                type="hidden"
                                name="shooter_id"
                                value={shooter!.id}
                              />
                              <input
                                type="hidden"
                                name="match_id"
                                value={match.id}
                              />
                              <Button type="submit" variant="secondary" size="sm">
                                Soy yo
                              </Button>
                            </form>
                          )}
                          {!canClaim &&
                            shooter?.linked_user_id &&
                            !isMine && (
                              <span className="text-xs text-fg-subtle">linkeado</span>
                            )}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </Card>
          </section>
        );
      })}
    </PageContainer>
  );
}

