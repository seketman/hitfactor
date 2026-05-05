"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/Table";
import { formatDate, formatPercent } from "@/lib/utils";
import { getClubCode, getClubName } from "@/lib/clubs";
import type { MyEntryRow } from "@/lib/db/types";

type SortKey = "date_desc" | "date_asc" | "pct_desc" | "pct_asc" | "place_asc";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "date_desc", label: "Más reciente" },
  { key: "date_asc", label: "Más antiguo" },
  { key: "pct_desc", label: "Mejor %" },
  { key: "pct_asc", label: "Peor %" },
  { key: "place_asc", label: "Mejor puesto" },
];

const POWER_FACTOR_LABELS: Record<string, string> = {
  Maj: "Major",
  Min: "Minor",
};

export function HistoryTable({ entries }: { entries: MyEntryRow[] }) {
  const [division, setDivision] = useState<string>("all");
  const [factor, setFactor] = useState<string>("all");
  const [club, setClub] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("date_desc");

  // Opciones disponibles según los datos del usuario
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
      const name = getClubName(e.matches?.region);
      if (code && name) set.set(code, name);
    }
    return Array.from(set.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [entries]);

  const filtered = useMemo(() => {
    let list = entries.slice();

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
  }, [entries, division, factor, club, sort]);

  return (
    <div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          label="División"
          value={division}
          onChange={(e) => setDivision(e.target.value)}
        >
          <option value="all">Todas</option>
          {divisionOptions.map(([code, name]) => (
            <option key={code} value={code}>
              {name} ({code})
            </option>
          ))}
        </Select>

        <Select
          label="Factor"
          value={factor}
          onChange={(e) => setFactor(e.target.value)}
        >
          <option value="all">Todos</option>
          <option value="Maj">Major</option>
          <option value="Min">Minor</option>
        </Select>

        <Select
          label="Club"
          value={club}
          onChange={(e) => setClub(e.target.value)}
        >
          <option value="all">Todos</option>
          {clubOptions.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </Select>

        <Select
          label="Ordenar por"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-10 text-center text-fg-muted">
          No hay torneos que coincidan con los filtros.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Fecha</TH>
                <TH>Torneo</TH>
                <TH>Club</TH>
                <TH>División</TH>
                <TH>Factor</TH>
                <TH className="text-right">Puesto</TH>
                <TH className="text-right">%</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((e) => {
                const clubName = getClubName(e.matches?.region);
                const clubCode = getClubCode(e.matches?.region);
                return (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap font-mono text-fg-muted">
                      {formatDate(e.matches?.date)}
                    </TD>
                    <TD>
                      <Link
                        href={`/matches/${e.matches?.id}`}
                        className="font-medium text-fg hover:text-accent"
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
                      {e.is_dq ? <Badge tone="danger">DQ</Badge> : e.place}
                    </TD>
                    <TD className="text-right font-mono">
                      {e.is_dq ? "—" : formatPercent(e.match_percentage)}
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
