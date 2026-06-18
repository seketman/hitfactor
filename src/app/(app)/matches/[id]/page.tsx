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
import { isHitsBasedDiscipline, isTimeBasedDiscipline } from "@/lib/disciplines";
import { isInternalAppPath } from "@/lib/redirects";
import { canEditEntry, canEditMatch } from "@/lib/permissions";
import { BackLink } from "@/components/BackLink";
import { toggleEntryAbsent } from "./actions";

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

  const [
    importerProfile,
    currentProfile,
    entries,
    stages,
    myShooters,
    clubs,
    claimAliases,
  ] = await Promise.all([
    getProfile(supabase, match.imported_by_user_id),
    getProfile(supabase, userId),
    listEntriesByMatch(supabase, id),
    listStagesByMatch(supabase, id),
    listMyShooters(supabase, userId),
    listClubs(supabase),
    getMyClaimAliases(supabase, userId),
  ]);

  const myShooterIds = new Set(myShooters.map((s) => s.id));
  const isImporter = match.imported_by_user_id === userId;
  const isAdmin = currentProfile?.is_admin === true;
  // Regla centralizada (espeja la RLS): importador o admin. Ver lib/permissions.
  const canEditThisMatch = canEditMatch({
    userId,
    isAdmin,
    importedByUserId: match.imported_by_user_id,
  });
  const parsedClub = parseRegion(match.region);
  const clubLookup = buildClubLookup(clubs);
  const clubLabel =
    getClubName(match.region, clubLookup) ?? match.region ?? null;
  // Tiro FBI rankea por impactos antes que por puntos — agregamos columna
  // Impactos y bajamos el énfasis visual de Puntos en la tabla.
  const isHitsBased = isHitsBasedDiscipline(match.disciplines);
  // Steel Challenge / Combat Solutions puntúan por tiempo: no usan
  // match_points (la columna queda en 0 para todos los entries) y el
  // ranking primario es total_time_seconds. Cambiamos la columna PUNTOS
  // por TIEMPO en esos casos así el usuario ve la métrica que importa.
  const isTimeBased = isTimeBasedDiscipline(match.disciplines);

  // Agrupar por división
  const byDivision = new Map<string, MatchEntryWithRelations[]>();
  for (const e of entries) {
    const code = e.divisions?.code ?? "?";
    if (!byDivision.has(code)) byDivision.set(code, []);
    byDivision.get(code)!.push(e);
  }
  const sortedDivisions = Array.from(byDivision.keys()).sort();

  // El back lo maneja el browser history (ver `BackLink`). El `?from=`
  // sigue siendo útil aparte para que `MatchActionsBar` (eliminar match,
  // editar club) redirija al destino correcto post-acción.
  const validFrom = isInternalAppPath(from) ? from : null;

  return (
    <PageContainer>
      <BackLink fallbackHref="/matches" />

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

        {canEditThisMatch && (
          <div className="w-full sm:w-auto sm:max-w-2xl sm:flex-1 sm:basis-auto">
            <MatchActionsBar
              matchId={match.id}
              currentRegion={match.region}
              currentClubCode={parsedClub.clubCode}
              currentMinShots={match.min_shots}
              clubs={clubs}
              isImporter={isImporter}
              isAdmin={isAdmin}
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
              {/* Alineación uniforme entre divisiones SOLO en md+ (≥768px):
                  `md:table-fixed` + anchos `md:w-*` idénticos en cada columna
                  hacen que todas las tablas alineen sus columnas en lugar de
                  ajustarse al largo de los nombres de cada división.

                  Debajo de md el layout vuelve a `auto` (sin min-w, sin
                  anchos fijos): el comportamiento original de móvil, donde las
                  columnas se ajustan al viewport y NO se fuerza scroll
                  horizontal. La alineación entre divisiones no se percibe en
                  móvil porque las tablas se apilan y se scrollean por separado.

                  `md:min-w-[44rem]` es el piso para que en tablet los anchos
                  fijos no se compriman por debajo de lo legible. */}
              <Table className="md:min-w-[44rem] md:table-fixed">
                <THead>
                  <TR>
                    {/* # crece solo en auto-layout (móvil) para contener el
                        badge "Ausente"/"DQ"; en md+ (table-fixed) necesita el
                        ancho explícito md:w-24 porque la columna no se ensancha
                        sola — con w-12 el badge se desbordaba sobre el nombre. */}
                    <TH className="w-12 md:w-24">#</TH>
                    <TH>Tirador</TH>
                    <TH className="md:w-40">Categoría</TH>
                    {isHitsBased && (
                      <TH className="text-right md:w-24">Impactos</TH>
                    )}
                    <TH className="text-right md:w-28">
                      {isTimeBased ? "Tiempo" : "Puntos"}
                    </TH>
                    <TH className="text-right md:w-20">%</TH>
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
                    // Toggle de ausencia: la RLS (0008) habilita tres autores
                    // y acá replicamos esa lógica para mostrar el botón solo
                    // cuando el flip va a funcionar.
                    //
                    // Además gateamos por score: solo tiene sentido marcar
                    // ausente a alguien con todo en cero. Si tiene puntos o %
                    // > 0, claramente disparó al menos un tiro y NO puede ser
                    // un ausente (forzando esa marca distorsionaría la verdad
                    // del registro). El botón "Sí asistió" sí aparece sobre
                    // entries ya marcadas como ausentes, para poder revertir.
                    const isLikelyAbsent =
                      e.match_points === 0 && e.match_percentage === 0;
                    const canToggleAbsent =
                      !e.is_dq &&
                      (e.is_absent || isLikelyAbsent) &&
                      canEditEntry({
                        userId,
                        isAdmin,
                        importedByUserId: match.imported_by_user_id,
                        isSelf: isMine,
                      });
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
                          {e.is_dq ? (
                            <Badge tone="danger">DQ</Badge>
                          ) : e.is_absent ? (
                            <Badge tone="default">Ausente</Badge>
                          ) : (
                            e.place
                          )}
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
                            {e.is_dq || e.is_absent ? "—" : (e.hits ?? "—")}
                          </TD>
                        )}
                        <TD
                          className={cn(
                            "text-right font-mono",
                            isHitsBased && "text-fg-muted",
                          )}
                        >
                          {e.is_dq || e.is_absent
                            ? "—"
                            : isTimeBased
                              ? e.total_time_seconds != null
                                ? `${formatNumber(e.total_time_seconds, 2)}s`
                                : "—"
                              : formatNumber(e.match_points, 2)}
                        </TD>
                        <TD
                          className={cn(
                            "text-right font-mono",
                            isHitsBased && "text-fg-muted",
                          )}
                        >
                          {e.is_dq || e.is_absent
                            ? "—"
                            : formatPercent(e.match_percentage)}
                        </TD>
                        <TD>
                          <div className="flex flex-col items-start gap-1">
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
                                <span className="text-xs text-fg-subtle">
                                  ya asociado
                                </span>
                              )}
                            {canToggleAbsent && (
                              <form action={toggleEntryAbsent}>
                                <input
                                  type="hidden"
                                  name="match_id"
                                  value={match.id}
                                />
                                <input
                                  type="hidden"
                                  name="entry_id"
                                  value={e.id}
                                />
                                <Button
                                  type="submit"
                                  variant="ghost"
                                  size="sm"
                                  className="text-xs"
                                >
                                  {e.is_absent
                                    ? "Sí asistió"
                                    : "Marcar ausente"}
                                </Button>
                              </form>
                            )}
                          </div>
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

