import { Link } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { requireUser } from "@/lib/supabase/require-user";
import { listAmmoUsageStats } from "@/lib/db/ammo";
import { createAmmo, deleteAmmo } from "@/lib/actions/ammo";
import { formatDate } from "@/lib/utils";

interface PageProps {
  searchParams: Promise<{ error?: string; new?: string }>;
}

export default async function AmmoPage({ searchParams }: PageProps) {
  const locale = await getLocale();
  const { error, new: showNew } = await searchParams;

  const { supabase, user } = await requireUser();
  const stats = await listAmmoUsageStats(supabase, user.id);

  return (
    <PageContainer className="max-w-3xl">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Tus municiones
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            Catálogo personal de tipos de munición — factory (compradas) y
            recargas. Asignalas a cada match desde tu página de participación
            para llevar registro de qué munición usaste y cómo te fue.
          </p>
        </div>
        {!showNew && stats.length > 0 && (
          <Link href="/ammo?new=1">
            <Button>Agregar munición</Button>
          </Link>
        )}
      </header>

      {error && (
        <Alert tone="danger" className="mb-6">
          {error}
        </Alert>
      )}

      {(showNew || stats.length === 0) && <NewAmmoForm cancelable={stats.length > 0} />}

      {stats.length > 0 && (
        <Card>
          <ul className="divide-y divide-border">
            {stats.map(({ ammo, totalRounds, totalMatches, lastUsedDate }) => (
              <li
                key={ammo.id}
                className="flex flex-wrap items-center gap-4 px-5 py-4"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/ammo/${ammo.id}`}
                    className="block font-medium hover:text-accent"
                  >
                    {ammo.name}
                  </Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted">
                    <Badge tone={ammo.type === "reload" ? "info" : "default"}>
                      {ammo.type === "reload" ? "recarga" : "factory"}
                    </Badge>
                    {ammo.caliber && <Badge tone="default">{ammo.caliber}</Badge>}
                    {ammo.brand && <span>{ammo.brand}</span>}
                    {ammo.bullet_weight_grains != null && (
                      <span>{ammo.bullet_weight_grains}gr</span>
                    )}
                    {ammo.power_factor && (
                      <Badge
                        tone={ammo.power_factor === "Maj" ? "accent" : "default"}
                      >
                        {ammo.power_factor}
                      </Badge>
                    )}
                    {ammo.power_factor_measured != null && (
                      <span className="font-mono">
                        PF {ammo.power_factor_measured}
                      </span>
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
                <form action={deleteAmmo}>
                  <input type="hidden" name="id" value={ammo.id} />
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

function NewAmmoForm({ cancelable }: { cancelable: boolean }) {
  return (
    <Card className="mb-6 p-6">
      <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-fg-muted">
        Nueva munición
      </h2>
      <form action={createAmmo} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Nombre"
            name="name"
            required
            placeholder="9mm Hornady 124gr FMJ"
          />
          <Select label="Tipo" name="type" required defaultValue="factory">
            <option value="factory">Factory</option>
            <option value="reload">Recarga</option>
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Calibre" name="caliber" placeholder="9x19" />
          <Input label="Marca" name="brand" placeholder="Hornady" />
          <Input
            label="Peso de punta (gr)"
            name="bullet_weight_grains"
            type="number"
            step="0.1"
            placeholder="124"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            label="Tipo de punta"
            name="bullet_type"
            placeholder="FMJ / HP / JSP…"
          />
          <Input label="Pólvora" name="powder" placeholder="Vihtavuori N320" />
          <Input
            label="Carga (gr)"
            name="powder_charge_grains"
            type="number"
            step="0.01"
            placeholder="4.3"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Factor declarado" name="power_factor" defaultValue="">
            <option value="">— Sin declarar —</option>
            <option value="Min">Min</option>
            <option value="Maj">Maj</option>
          </Select>
          <Input
            label="Factor medido (PF)"
            name="power_factor_measured"
            type="number"
            step="0.1"
            placeholder="139.5"
            hint="peso (gr) × velocidad (fps) / 1000"
          />
        </div>
        <Input
          label="Notas"
          name="notes"
          placeholder="Cualquier detalle adicional"
        />
        <div className="flex gap-2">
          <Button type="submit">Guardar</Button>
          {cancelable && (
            <Link href="/ammo">
              <Button type="button" variant="ghost">
                Cancelar
              </Button>
            </Link>
          )}
        </div>
      </form>
    </Card>
  );
}
