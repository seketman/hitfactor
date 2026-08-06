"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/Table";
import { cn, formatDate, formatPercent } from "@/lib/utils";
import { buildClubLookup, getClubCode, getClubName } from "@/lib/clubs";
import {
  getAmmoExtrasTier,
  type AmmoExtrasTier,
} from "@/lib/stats/shooter-stats";
import type { Club, MyEntryRow } from "@/lib/db/types";

// Mismo mapping de tier→color se reutiliza en match-me y StatsOverview.
// Lo dejamos local (no en un util compartido) porque cada surface usa el
// tono de forma ligeramente distinta (acá solo color de texto) y mover esto
// fuera no compensa la indirección.
const EXTRAS_TIER_CLASS: Record<AmmoExtrasTier, string> = {
  perfect: "text-success",
  neutral: "",
  warning: "text-accent",
  danger: "text-danger",
};

type SortKey = "date_desc" | "date_asc" | "pct_desc" | "pct_asc" | "place_asc";

const SORT_OPTIONS: { key: SortKey; labelKey: string }[] = [
  { key: "date_desc", labelKey: "sortDateDesc" },
  { key: "date_asc", labelKey: "sortDateAsc" },
  { key: "pct_desc", labelKey: "sortPctDesc" },
  { key: "pct_asc", labelKey: "sortPctAsc" },
  { key: "place_asc", labelKey: "sortPlaceAsc" },
];

const POWER_FACTOR_LABELS: Record<string, string> = {
  Maj: "Major",
  Min: "Minor",
};

interface HistoryTableProps {
  entries: MyEntryRow[];
  /**
   * Catálogo de clubes para resolver `match.region` → nombre completo.
   * El caller (DashboardView) hace `listClubs()` y lo pasa.
   */
  clubs: ReadonlyArray<Pick<Club, "code" | "name">>;
  /**
   * Si false, esconde el filtro de disciplina (se asume que el caller ya
   * filtró por disciplina vía URL — ej. /dashboard/[discipline]).
   * Default: true (vista consolidada).
   */
  showDisciplineFilter?: boolean;
}

export function HistoryTable({
  entries,
  clubs,
  showDisciplineFilter = true,
}: HistoryTableProps) {
  const t = useTranslations("dashboard.history");
  const locale = useLocale();
  const clubLookup = useMemo(() => buildClubLookup(clubs), [clubs]);
  const [discipline, setDiscipline] = useState<string>("all");
  const [division, setDivision] = useState<string>("all");
  const [factor, setFactor] = useState<string>("all");
  const [club, setClub] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("date_desc");

  // Opciones disponibles según los datos del usuario
  const disciplineOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const e of entries) {
      const d = e.matches?.disciplines;
      if (d) set.set(d.code, d.name);
    }
    return Array.from(set.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [entries]);

  const divisionOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const e of entries) {
      if (e.divisions) set.set(e.divisions.code, e.divisions.name);
    }
    return Array.from(set.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [entries]);

  const clubOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const e of entries) {
      const code = getClubCode(e.matches?.region);
      const name = getClubName(e.matches?.region, clubLookup);
      if (code && name) set.set(code, name);
    }
    return Array.from(set.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [entries, clubLookup]);

  const filtered = useMemo(() => {
    let list = entries.slice();

    if (discipline !== "all") {
      list = list.filter((e) => e.matches?.disciplines?.code === discipline);
    }
    if (division !== "all") {
      list = list.filter((e) => e.divisions?.code === division);
    }
    if (factor !== "all") {
      list = list.filter((e) => e.power_factor === factor);
    }
    if (club !== "all") {
      list = list.filter((e) => getClubCode(e.matches?.region) === club);
    }

    list.sort((a, b) => {
      switch (sort) {
        case "date_desc":
          return (b.matches?.date ?? "").localeCompare(a.matches?.date ?? "");
        case "date_asc":
          return (a.matches?.date ?? "").localeCompare(b.matches?.date ?? "");
        case "pct_desc":
          return Number(b.match_percentage) - Number(a.match_percentage);
        case "pct_asc":
          return Number(a.match_percentage) - Number(b.match_percentage);
        case "place_asc":
          return a.place - b.place;
      }
    });

    return list;
  }, [entries, discipline, division, factor, club, sort]);

  // Mostramos columna "Impactos" solo si al menos una fila filtrada la tiene
  // (Tiro FBI). Calculado sobre `filtered` para que al cambiar el filtro de
  // disciplina la columna aparezca/desaparezca según haga sentido.
  const showHits = useMemo(
    () => filtered.some((e) => e.hits !== null),
    [filtered],
  );

  // Mostramos columna "Extras" (disparos por encima del mínimo, issue #75)
  // solo si al menos una fila tiene ambos datos: el match con `min_shots`
  // poblado y el log del arma con `rounds_fired`. Para usuarios que no
  // registraron armas / matches sin mínimo, la columna desaparece y el
  // ancho de la tabla no se infla con un mar de "—".
  const showExtras = useMemo(
    () =>
      filtered.some(
        (e) =>
          e.matches?.min_shots != null &&
          e.match_firearm_log?.rounds_fired != null,
      ),
    [filtered],
  );

  return (
    <div>
      <div
        className={cn(
          "mb-4 grid gap-3 sm:grid-cols-2",
          showDisciplineFilter ? "lg:grid-cols-5" : "lg:grid-cols-4",
        )}
      >
        {showDisciplineFilter && (
          <Select
            label={t("discipline")}
            value={discipline}
            onChange={(e) => setDiscipline(e.target.value)}
          >
            <option value="all">{t("all")}</option>
            {disciplineOptions.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </Select>
        )}

        <Select
          label={t("division")}
          value={division}
          onChange={(e) => setDivision(e.target.value)}
        >
          <option value="all">{t("all")}</option>
          {divisionOptions.map(([code, name]) => (
            <option key={code} value={code}>
              {name} ({code})
            </option>
          ))}
        </Select>

        <Select
          label={t("factor")}
          value={factor}
          onChange={(e) => setFactor(e.target.value)}
        >
          <option value="all">{t("allMasc")}</option>
          <option value="Maj">Major</option>
          <option value="Min">Minor</option>
        </Select>

        <Select
          label={t("club")}
          value={club}
          onChange={(e) => setClub(e.target.value)}
        >
          <option value="all">{t("allMasc")}</option>
          {clubOptions.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </Select>

        <Select
          label={t("sortBy")}
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {t(o.labelKey)}
            </option>
          ))}
        </Select>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-10 text-center text-fg-muted">
          {t("noMatches")}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>{t("colDate")}</TH>
                <TH>{t("colDiscipline")}</TH>
                <TH>{t("colMatch")}</TH>
                <TH>{t("colClub")}</TH>
                <TH>{t("colDivision")}</TH>
                <TH>{t("colFactor")}</TH>
                <TH className="text-right">{t("colPlace")}</TH>
                {showHits && <TH className="text-right">{t("colHits")}</TH>}
                {showExtras && (
                  <TH className="text-right" title={t("extrasTooltip")}>
                    {t("colExtras")}
                  </TH>
                )}
                <TH className="text-right">%</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((e) => {
                const clubName = getClubName(e.matches?.region, clubLookup);
                const clubCode = getClubCode(e.matches?.region);
                const disc = e.matches?.disciplines;
                // Fila FBI (o cualquier hits-based): destacamos impactos y
                // bajamos énfasis del %.
                const hasHits = e.hits !== null;
                return (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap font-mono text-fg-muted">
                      {formatDate(e.matches?.date, locale)}
                    </TD>
                    <TD className="text-fg-muted">
                      {disc ? <span title={disc.code}>{disc.name}</span> : "—"}
                    </TD>
                    <TD>
                      <Link
                        href={`/matches/${e.matches?.id}/me?entry=${e.id}`}
                        className="font-medium text-fg hover:text-accent"
                        title={t("matchLinkTitle")}
                      >
                        {e.matches?.name}
                      </Link>
                    </TD>
                    <TD className="text-fg-muted">
                      {clubName ? (
                        <span title={clubName}>{clubCode}</span>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD>
                      {e.divisions ? (
                        <Badge>{e.divisions.code}</Badge>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD className="text-fg-muted">
                      {e.power_factor
                        ? POWER_FACTOR_LABELS[e.power_factor]
                        : "—"}
                    </TD>
                    <TD className="text-right font-mono">
                      {e.is_dq ? (
                        <Badge tone="danger">{t("dq")}</Badge>
                      ) : e.is_absent ? (
                        <Badge tone="default">{t("absent")}</Badge>
                      ) : (
                        e.place
                      )}
                    </TD>
                    {showHits && (
                      <TD className="text-right font-mono font-semibold text-fg">
                        {e.is_dq || e.is_absent ? "—" : (e.hits ?? "—")}
                      </TD>
                    )}
                    {showExtras && (
                      <TD className="text-right font-mono">
                        <ExtrasCell
                          minShots={e.matches?.min_shots ?? null}
                          roundsFired={e.match_firearm_log?.rounds_fired ?? null}
                          tooltip={(min, used) =>
                            t("extrasCellTooltip", { min, used })
                          }
                        />
                      </TD>
                    )}
                    <TD
                      className={cn(
                        "text-right font-mono",
                        hasHits && "text-fg-muted",
                      )}
                    >
                      {e.is_dq || e.is_absent
                        ? "—"
                        : formatPercent(e.match_percentage)}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

/**
 * Celda de "disparos extra" (issue #75). Renderiza:
 *  - `+N` en rojo cuando el tirador usó más balas que el mínimo (caso típico).
 *  - `0` en verde cuando coincide exactamente con el mínimo (eficiencia perfecta).
 *  - `—` cuando falta cualquiera de los dos datos (no debería pasar si la
 *    columna se muestra, pero defensivo).
 *
 * Tooltip con el desglose mín/usados para que el usuario entienda de dónde
 * sale el número sin abrir el detalle del match.
 */
function ExtrasCell({
  minShots,
  roundsFired,
  tooltip,
}: {
  minShots: number | null;
  roundsFired: number | null;
  tooltip: (min: number, used: number) => string;
}) {
  if (minShots == null || roundsFired == null) {
    return <span className="text-fg-subtle">—</span>;
  }
  const extras = roundsFired - minShots;
  const tier = getAmmoExtrasTier(extras, minShots);
  return (
    <span
      title={tooltip(minShots, roundsFired)}
      className={cn("tabular-nums", EXTRAS_TIER_CLASS[tier])}
    >
      {extras > 0 ? `+${extras}` : extras}
    </span>
  );
}
