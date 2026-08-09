import { Link } from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { requireUser } from "@/lib/supabase/require-user";
import { listAuditLog } from "@/lib/db/audit";
import { describeAuditEntry } from "@/lib/audit/render";
import { formatDateTime } from "@/lib/utils";
import { getRequestTimeZone } from "@/lib/timezone";

interface PageProps {
  searchParams: Promise<{ page?: string }>;
}

const PAGE_SIZE = 50;

export default async function ActivityPage({ searchParams }: PageProps) {
  const locale = await getLocale();
  const timeZone = await getRequestTimeZone();
  const t = await getTranslations("activityLog");
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  const { supabase, user } = await requireUser();
  const { rows, total } = await listAuditLog(
    supabase,
    user.id,
    page,
    PAGE_SIZE,
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PageContainer className="max-w-3xl">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Tu actividad</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Registro cronológico de los cambios que hiciste sobre tus datos.
          Solo vos podés ver esta lista.
        </p>
      </header>

      {rows.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-fg-muted">
            Todavía no hay actividad registrada.
          </p>
          <p className="mt-2 text-xs text-fg-subtle">
            Cualquier acción que hagas (importar un match, asignar un arma,
            asociar una participación a tu cuenta, etc.) va a aparecer acá.
          </p>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {rows.map((row) => {
              const desc = describeAuditEntry(row, t);
              return (
                <li
                  key={row.id}
                  className="flex flex-wrap items-start justify-between gap-3 px-5 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{desc.summary}</p>
                    {desc.detail && (
                      <p className="mt-0.5 text-xs text-fg-muted">
                        {desc.detail}
                      </p>
                    )}
                    <p className="mt-1 font-mono text-xs text-fg-subtle">
                      {formatDateTime(row.created_at, locale, timeZone)}
                    </p>
                  </div>
                  {desc.link && (
                    <Link
                      href={desc.link.href}
                      className="text-xs text-accent hover:underline"
                    >
                      {desc.link.label} →
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} total={total} />
      )}
    </PageContainer>
  );
}

function Pagination({
  page,
  totalPages,
  total,
}: {
  page: number;
  totalPages: number;
  total: number;
}) {
  const prev = page > 1 ? page - 1 : null;
  const next = page < totalPages ? page + 1 : null;

  return (
    <nav className="mt-6 flex items-center justify-between gap-3 text-sm">
      <span className="text-xs text-fg-subtle">
        {total} acciones · página {page} de {totalPages}
      </span>
      <div className="flex gap-2">
        {prev ? (
          <Link href={`/activity?page=${prev}`}>
            <Button variant="ghost" size="sm">
              ← Anterior
            </Button>
          </Link>
        ) : (
          <Button variant="ghost" size="sm" disabled>
            ← Anterior
          </Button>
        )}
        {next ? (
          <Link href={`/activity?page=${next}`}>
            <Button variant="ghost" size="sm">
              Siguiente →
            </Button>
          </Link>
        ) : (
          <Button variant="ghost" size="sm" disabled>
            Siguiente →
          </Button>
        )}
      </div>
    </nav>
  );
}
