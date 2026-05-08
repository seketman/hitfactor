import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { parseRegion } from "@/lib/clubs";
import { formatDate } from "@/lib/utils";

export interface MatchListItem {
  id: string;
  name: string;
  date: string;
  region: string | null;
  imported_by_user_id: string;
  disciplines: { code: string; name: string } | null;
}

interface MatchListProps {
  matches: MatchListItem[];
  /** id del usuario logueado, para mostrar "vos importaste". */
  userId: string;
  /**
   * Ruta de origen para que la página del match pueda volver acá con
   * "← Volver". Ej: "/matches" o "/dashboard/ipsc".
   */
  from: string;
}

/**
 * Lista de matches en formato de filas. Cada fila linkea al detalle del match
 * preservando el origen via `?from=` para que el "← Volver" del detalle vuelva
 * acá.
 *
 * Reutilizable desde:
 *  - `/matches` (grilla principal de todos los matches)
 *  - `/dashboard` (deprecated — se sacó la sección, queda por compat si vuelve)
 */
export function MatchList({ matches, userId, from }: MatchListProps) {
  return (
    <Card>
      <ul className="divide-y divide-border">
        {matches.map((m) => {
          const isMine = m.imported_by_user_id === userId;
          const club = parseRegion(m.region);
          const clubLabel = club.clubName ?? club.clubCode ?? m.region;
          return (
            <li key={m.id}>
              <Link
                href={`/matches/${m.id}?from=${encodeURIComponent(from)}`}
                className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-surface-2/40"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    <span className="truncate">{m.name}</span>
                    {m.disciplines && (
                      <Badge tone="accent" title={m.disciplines.code}>
                        {m.disciplines.name}
                      </Badge>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {formatDate(m.date)}
                    {clubLabel && ` · ${clubLabel}`}
                  </p>
                </div>
                {isMine && <Badge>vos importaste</Badge>}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
