import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { claimShooter } from "@/lib/actions/claim";
import { dismissClaimSuggestions } from "@/app/(app)/matches/actions";
import { formatDate } from "@/lib/utils";
import type { ClaimSuggestion } from "@/lib/db/claim-suggestions";

interface ClaimSuggestionsProps {
  suggestions: ClaimSuggestion[];
}

/**
 * Card de onboarding que aparece arriba del listado de matches cuando el
 * usuario todavía no claimó ninguna identidad. Le presenta los shooters
 * huérfanos que más se parecen al perfil — para que el primer "Soy yo" sea
 * un click, no una expedición.
 *
 * Cada fila usa `claimShooter` con `redirect_to=/matches` para que después
 * del claim caigamos en esta misma página: el gate primario (myShooters > 0)
 * ya hace que la card desaparezca y se vea la grilla normal con stats.
 *
 * "Ocultar sugerencias" es la válvula de escape para los casos en que
 * ninguno de los candidatos es realmente el usuario (típico: nombre común
 * + matches importados por otros que no son tuyos).
 */
export function ClaimSuggestions({ suggestions }: ClaimSuggestionsProps) {
  if (suggestions.length === 0) return null;

  return (
    <Card className="mb-6 border-accent/40 bg-accent-soft/40">
      <div className="px-5 py-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-fg">
              ¿Sos vos en alguno de estos matches?
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              Encontramos{" "}
              {suggestions.length === 1
                ? "un tirador"
                : `${suggestions.length} tiradores`}{" "}
              con nombre parecido al tuyo. Si sos vos, hacé click en{" "}
              <span className="font-medium text-fg">&ldquo;Soy yo&rdquo;</span>{" "}
              para asociar esa participación a tu cuenta y empezar a ver tus
              resultados.
            </p>
          </div>
        </div>

        <ul className="divide-y divide-border rounded-md border border-border bg-surface">
          {suggestions.map((s) => (
            <li
              key={s.shooterId}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="font-medium">{s.shooterName}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
                  <Link
                    href={`/matches/${s.matchId}?from=/matches`}
                    className="hover:text-accent"
                  >
                    {s.matchName}
                  </Link>
                  <span className="text-fg-subtle">·</span>
                  <span className="font-mono">{formatDate(s.matchDate)}</span>
                  {s.divisionCode && (
                    <>
                      <span className="text-fg-subtle">·</span>
                      <Badge title={s.divisionName ?? undefined}>
                        {s.divisionCode}
                      </Badge>
                    </>
                  )}
                  <span className="text-fg-subtle">·</span>
                  <span>Puesto {s.place}</span>
                </p>
              </div>
              <form action={claimShooter}>
                <input
                  type="hidden"
                  name="shooter_id"
                  value={s.shooterId}
                />
                <input type="hidden" name="redirect_to" value="/matches" />
                <Button type="submit" size="sm">
                  Soy yo
                </Button>
              </form>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex justify-end">
          <form action={dismissClaimSuggestions}>
            <Button type="submit" variant="ghost" size="sm">
              No soy ninguno · Ocultar sugerencias
            </Button>
          </form>
        </div>
      </div>
    </Card>
  );
}
