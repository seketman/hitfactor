import { notFound } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/Table";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/db/profiles";
import { listMyShooters } from "@/lib/db/shooters";
import { listClubs } from "@/lib/db/clubs";
import {
  getMatchById,
  listEntriesByMatch,
  listStagesByMatch,
} from "@/lib/db/matches";
import { parseRegion } from "@/lib/clubs";
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
} from "@/lib/utils";
import type { MatchEntryWithRelations } from "@/lib/db/types";
import { claimShooter } from "@/lib/actions/claim";
import { EditClubButton } from "@/components/EditClubButton";
import { deleteMatch } from "./actions";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}

export default async function MatchDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { error } = await searchParams;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user!.id;

  const match = await getMatchById(supabase, id);
  if (!match) notFound();

  const [importerProfile, entries, stages, myShooters, clubs] = await Promise.all([
    getProfile(supabase, match.imported_by_user_id),
    listEntriesByMatch(supabase, id),
    listStagesByMatch(supabase, id),
    listMyShooters(supabase, userId),
    listClubs(supabase),
  ]);

  const myShooterIds = new Set(myShooters.map((s) => s.id));
  const isImporter = match.imported_by_user_id === userId;
  const parsedClub = parseRegion(match.region);
  const clubLabel =
    parsedClub.clubName ?? parsedClub.clubCode ?? match.region ?? null;

  // Agrupar por división
  const byDivision = new Map<string, MatchEntryWithRelations[]>();
  for (const e of entries) {
    const code = e.divisions?.code ?? "?";
    if (!byDivision.has(code)) byDivision.set(code, []);
    byDivision.get(code)!.push(e);
  }
  const sortedDivisions = Array.from(byDivision.keys()).sort();

  return (
    <PageContainer>
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
          <div className="flex items-center gap-2">
            <EditClubButton
              matchId={match.id}
              currentRegion={match.region}
              currentCountry={parsedClub.country}
              currentClubCode={parsedClub.clubCode}
              clubs={clubs}
            />
            <form action={deleteMatch}>
              <input type="hidden" name="match_id" value={match.id} />
              <Button type="submit" variant="danger" size="sm">
                Eliminar
              </Button>
            </form>
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
                    <TH className="text-right">Puntos</TH>
                    <TH className="text-right">%</TH>
                    <TH className="w-28"></TH>
                  </TR>
                </THead>
                <TBody>
                  {list.map((e) => {
                    const shooter = e.shooters;
                    const isMine = !!shooter && myShooterIds.has(shooter.id);
                    // Cualquier shooter no linkeado es claimable: un usuario
                    // puede tener varias identidades (una por disciplina).
                    const canClaim =
                      !!shooter && shooter.linked_user_id === null;
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
                        <TD className="text-right font-mono">
                          {e.is_dq ? "—" : formatNumber(e.match_points, 2)}
                        </TD>
                        <TD className="text-right font-mono">
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
