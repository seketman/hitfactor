import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { buildClubLookup, getClubName } from "@/lib/clubs";
import { formatDate } from "@/lib/utils";
import type { Club } from "@/lib/db/types";

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
  /**
   * Catálogo de clubes para resolver `region` → nombre completo. La page
   * que renderiza esta lista hace `listClubs()` y lo pasa.
   */
  clubs: ReadonlyArray<Pick<Club, "code" | "name">>;
}

/**
 * Lista de matches en formato de filas. Cada fila linkea al detalle del match
 * preservando el origen via `?from=` para que el "← Volver" del detalle vuelva
 * acá. Hoy se usa solo desde `/matches`; el prop `from` queda genérico por si
 * vuelve a renderizarse desde otra ruta.
 */
export async function MatchList({ matches, userId, from, clubs }: MatchListProps) {
  const locale = await getLocale();
  const t = await getTranslations("matches");
  const clubLookup = buildClubLookup(clubs);
  return (
    <Card>
      <ul className="divide-y divide-border">
        {matches.map((m) => {
          const isMine = m.imported_by_user_id === userId;
          const clubLabel = getClubName(m.region, clubLookup) ?? m.region;
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
                    {formatDate(m.date, locale)}
                    {clubLabel && ` · ${clubLabel}`}
                  </p>
                </div>
                {isMine && <Badge>{t("youImported")}</Badge>}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
