import { Link } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { requireUser } from "@/lib/supabase/require-user";
import { listFirearmUsageStats } from "@/lib/db/firearms";
import { createFirearm, deleteFirearm } from "@/lib/actions/firearms";
import { formatDate } from "@/lib/utils";

interface PageProps {
  searchParams: Promise<{ error?: string; new?: string }>;
}

export default async function FirearmsPage({ searchParams }: PageProps) {
  const locale = await getLocale();
  const { error, new: showNew } = await searchParams;

  const { supabase, user } = await requireUser();
  const stats = await listFirearmUsageStats(supabase, user.id);

  return (
    <PageContainer className="max-w-3xl">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tus armas</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Catálogo personal. Asignalas a cada match desde tu página de
            participación para llevar un registro de su uso y disparos
            efectuados.
          </p>
        </div>
        {!showNew && stats.length > 0 && (
          <Link href="/firearms?new=1">
            <Button>Agregar arma</Button>
          </Link>
        )}
      </header>

      {error && (
        <Alert tone="danger" className="mb-6">
          {error}
        </Alert>
      )}

      {(showNew || stats.length === 0) && (
        <Card className="mb-6 p-6">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-fg-muted">
            Nueva arma
          </h2>
          <form action={createFirearm} className="space-y-4">
            <Input
              label="Nombre"
              name="name"
              required
              placeholder="Ej: Glock 17 - service"
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Input label="Marca" name="brand" placeholder="Glock" />
              <Input label="Modelo" name="model" placeholder="17 Gen 5" />
              <Input label="Calibre" name="caliber" placeholder="9x19" />
            </div>
            <Input
              label="Notas"
              name="notes"
              placeholder="Cualquier detalle adicional"
            />
            <div className="flex gap-2">
              <Button type="submit">Guardar</Button>
              {stats.length > 0 && (
                <Link href="/firearms">
                  <Button type="button" variant="ghost">
                    Cancelar
                  </Button>
                </Link>
              )}
            </div>
          </form>
        </Card>
      )}

      {stats.length > 0 && (
        <Card>
          <ul className="divide-y divide-border">
            {stats.map(({ firearm, totalRounds, totalMatches, lastUsedDate }) => (
              <li
                key={firearm.id}
                className="flex flex-wrap items-center gap-4 px-5 py-4"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/firearms/${firearm.id}`}
                    className="block font-medium hover:text-accent"
                  >
                    {firearm.name}
                  </Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted">
                    {firearm.brand && <span>{firearm.brand}</span>}
                    {firearm.model && <span>{firearm.model}</span>}
                    {firearm.caliber && (
                      <Badge tone="default">{firearm.caliber}</Badge>
                    )}
                  </p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-mono text-fg">
                    {totalRounds.toLocaleString("es-AR")} tiros
                  </p>
                  <p className="text-xs text-fg-subtle">
                    {totalMatches} torneo{totalMatches === 1 ? "" : "s"}
                    {lastUsedDate && ` · últ. ${formatDate(lastUsedDate, locale)}`}
                  </p>
                </div>
                <form action={deleteFirearm}>
                  <input type="hidden" name="id" value={firearm.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:text-danger"
                  >
                    Borrar
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </PageContainer>
  );
}
