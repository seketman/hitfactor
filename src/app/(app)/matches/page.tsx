import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MatchList } from "@/components/MatchList";
import { Pagination } from "@/components/Pagination";
import { ClaimSuggestions } from "@/components/ClaimSuggestions";
import { requireUser } from "@/lib/supabase/require-user";
import { listMatchesPage } from "@/lib/db/matches";
import { listClubs } from "@/lib/db/clubs";
import { listMyShooters } from "@/lib/db/shooters";
import { findClaimSuggestions } from "@/lib/db/claim-suggestions";
import { getUiPrefs } from "@/lib/db/profiles";
import { saveMatchesPageSize } from "./actions";

/**
 * Listado de todos los matches del sistema. Antes vivía como sección dentro
 * del dashboard; lo movimos acá para dejar al dashboard enfocado en la info
 * del tirador (KPIs + historial).
 *
 * El botón "Importar match" reemplaza al item "Importar" del sidebar — ahora
 * es la acción principal de esta página.
 *
 * Paginación server-side via `?page` y `?size`. Los tamaños permitidos son
 * fijos (PAGE_SIZES) para que un `size` arbitrario en la URL no nos haga
 * pedirle 10_000 filas a la DB.
 */

const PAGE_SIZES = [10, 20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 20;

interface PageProps {
  searchParams: Promise<{ page?: string; size?: string }>;
}

export default async function MatchesPage({ searchParams }: PageProps) {
  const { page: pageParam, size: sizeParam } = await searchParams;

  const { supabase, user } = await requireUser();

  // Si la URL trae `?size=N` y es válido, gana — eso permite compartir un
  // link con un tamaño puntual sin pisar la preferencia. Si no, usamos lo
  // que el usuario guardó en su perfil. Si nunca guardó nada, default 20.
  const uiPrefs = await getUiPrefs(supabase, user.id);
  const parsedUrlSize = Number(sizeParam);
  const urlSizeValid =
    sizeParam != null &&
    (PAGE_SIZES as ReadonlyArray<number>).includes(parsedUrlSize);
  const savedSize = uiPrefs.matchesPageSize;
  const savedSizeValid =
    savedSize != null && (PAGE_SIZES as ReadonlyArray<number>).includes(savedSize);
  const size = urlSizeValid
    ? parsedUrlSize
    : savedSizeValid
      ? savedSize
      : DEFAULT_PAGE_SIZE;

  const parsedPage = Math.floor(Number(pageParam));
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const [{ matches, total }, clubs, myShooters] = await Promise.all([
    listMatchesPage(supabase, { page, size }),
    listClubs(supabase),
    listMyShooters(supabase, user.id),
  ]);

  // Sugerencias de claim. Las mostramos en dos escenarios:
  //  - Onboarding: el usuario todavía no claimó nada — "Soy yo" arriba del
  //    listado para que el primer claim sea un click.
  //  - Identidades adicionales: el usuario ya tiene shooters linkeados pero
  //    `findClaimSuggestions` encontró otras filas con nombre/socio parecido
  //    (típico: el mismo tirador tipeado distinto en distintos torneos).
  //
  // En ambos casos respetamos el flag `claimSuggestionsDismissed` para no
  // ser invasivos. Como contrapartida: si dismisseaste en algún momento,
  // las futuras sugerencias no aparecen automáticamente — refinable más
  // adelante (dismiss por shooter o con expiración).
  const showSuggestions = !uiPrefs.claimSuggestionsDismissed;
  const suggestions = showSuggestions
    ? await findClaimSuggestions(supabase, user.id)
    : [];
  const hasExistingClaims = myShooters.length > 0;

  const totalPages = Math.max(1, Math.ceil(total / size));

  return (
    <PageContainer>
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Matches</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {total === 0
              ? "Todavía no se importó ningún match."
              : `${total} torneo${total === 1 ? "" : "s"} cargado${total === 1 ? "" : "s"} en HitFactor`}
          </p>
          {total > 0 && (
            <p className="mt-1 max-w-prose text-sm text-fg-subtle">
              Los importa la comunidad y quedan disponibles para todos. Buscá
              uno en el que hayas participado y marcate con “Soy yo” — no hace
              falta volver a subirlo.
            </p>
          )}
        </div>
        <Link href="/import">
          <Button>Importar match</Button>
        </Link>
      </header>

      {total === 0 ? (
        <Card className="p-10 text-center">
          <p className="mx-auto max-w-prose text-fg-muted">
            Sé el primero en importar uno desde tu planilla de PractiScore o el
            CSV de Tiro FBI. Va a quedar disponible para todos los tiradores que
            participaron, no solo para vos.
          </p>
          <Link href="/import" className="mt-4 inline-block">
            <Button size="sm">Importar el primero</Button>
          </Link>
        </Card>
      ) : (
        <>
          {suggestions.length > 0 && (
            <ClaimSuggestions
              suggestions={suggestions}
              hasExistingClaims={hasExistingClaims}
            />
          )}
          <MatchList
            matches={matches}
            userId={user.id}
            from="/matches"
            clubs={clubs}
          />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            size={size}
            sizes={PAGE_SIZES}
            basePath="/matches"
            itemLabel={{ one: "torneo", many: "torneos" }}
            onSizeChange={saveMatchesPageSize}
          />
        </>
      )}
    </PageContainer>
  );
}
