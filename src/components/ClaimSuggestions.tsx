import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { claimShooter } from "@/lib/actions/claim";
import { dismissClaimSuggestions } from "@/app/[locale]/(app)/matches/actions";
import { formatDate } from "@/lib/utils";
import type { ClaimSuggestion } from "@/lib/db/claim-suggestions";

interface ClaimSuggestionsProps {
  suggestions: ClaimSuggestion[];
  /**
   * Si `true`, el usuario ya tiene shooters linkeados — el card pasa de
   * "onboarding" (primer claim) a "identidades adicionales" (más variantes
   * del mismo tirador tipeadas distinto en otros torneos). Cambia el copy
   * pero no el comportamiento.
   */
  hasExistingClaims?: boolean;
}

/**
 * Card que aparece arriba del listado de matches presentando shooters
 * huérfanos cuyos nombres se parecen a los del usuario.
 *
 * Dos modos:
 *  - Onboarding (sin claims previos): "Soy yo" para empezar a ver stats.
 *  - Identidades adicionales (con claims previos): variantes tipeadas
 *    distinto del mismo tirador en otros torneos — claimalas para que
 *    sumen a tus stats existentes.
 *
 * Cada fila usa `claimShooter` con `redirect_to=/matches` para que después
 * del claim caigamos en esta misma página: como la lista se recalcula,
 * los shooters ya claimados desaparecen y, si quedan más sugerencias,
 * el card se mantiene.
 *
 * "Ocultar sugerencias" es la válvula de escape para los casos en que
 * ninguno de los candidatos es realmente el usuario.
 */
export async function ClaimSuggestions({
  suggestions,
  hasExistingClaims = false,
}: ClaimSuggestionsProps) {
  if (suggestions.length === 0) return null;

  const locale = await getLocale();
  const t = await getTranslations("matches");

  const shooters = t("claimSuggestions.shooterCount", {
    count: suggestions.length,
  });

  // Both branches spelled out instead of `t(condition ? a : b)`: a computed
  // key cannot be checked against the catalogue, and `translation-keys.test.ts`
  // tracks every file that builds one.
  const strong = (chunks: ReactNode) => (
    <span className="font-medium text-fg">{chunks}</span>
  );
  const title = hasExistingClaims
    ? t("claimSuggestions.titleMore")
    : t("claimSuggestions.titleFirst");
  const body = hasExistingClaims
    ? t.rich("claimSuggestions.bodyMore", { shooters, strong })
    : t.rich("claimSuggestions.bodyFirst", { shooters, strong });

  return (
    <Card className="mb-6 border-accent/40 bg-accent-soft/40">
      <div className="px-5 py-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            <p className="mt-1 text-sm text-fg-muted">{body}</p>
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
                  <span className="font-mono">
                    {formatDate(s.matchDate, locale)}
                  </span>
                  {s.divisionCode && (
                    <>
                      <span className="text-fg-subtle">·</span>
                      <Badge title={s.divisionName ?? undefined}>
                        {s.divisionCode}
                      </Badge>
                    </>
                  )}
                  <span className="text-fg-subtle">·</span>
                  <span>
                    {t("claimSuggestions.place", { place: s.place })}
                  </span>
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
                  {t("detail.imYou")}
                </Button>
              </form>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex justify-end">
          <form action={dismissClaimSuggestions}>
            <Button type="submit" variant="ghost" size="sm">
              {t("claimSuggestions.dismiss")}
            </Button>
          </form>
        </div>
      </div>
    </Card>
  );
}
