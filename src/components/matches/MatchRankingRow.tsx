import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { TD, TR } from "@/components/ui/Table";
import { cn, formatNumber, formatPercent } from "@/lib/utils";
import type { MatchEntryWithRelations } from "@/lib/db/types";
import { claimShooter } from "@/lib/actions/claim";
import { PlaceCell } from "@/components/matches/PlaceCell";
import { toggleEntryAbsent } from "@/app/(app)/matches/[id]/actions";

/**
 * Fila del ranking público de un match. El cómputo de los flags
 * (`isMine`, `canClaim`, `canToggleAbsent`) y el contexto de la disciplina
 * (`isHitsBased`/`isTimeBased`) se calculan en la página y se pasan como
 * props — acá solo vive el JSX, movido verbatim desde matches/[id]/page.tsx.
 */
export function MatchRankingRow({
  entry: e,
  matchId,
  isMine,
  canClaim,
  canToggleAbsent,
  isHitsBased,
  isTimeBased,
}: {
  entry: MatchEntryWithRelations;
  matchId: string;
  isMine: boolean;
  canClaim: boolean;
  canToggleAbsent: boolean;
  isHitsBased: boolean;
  isTimeBased: boolean;
}) {
  const shooter = e.shooters;
  return (
    <TR
      className={
        isMine ? "bg-accent-soft hover:bg-accent-soft" : undefined
      }
    >
      <TD className="text-fg-muted">
        <PlaceCell isDq={e.is_dq} isAbsent={e.is_absent} place={e.place} />
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
                value={matchId}
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
                value={matchId}
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
}
