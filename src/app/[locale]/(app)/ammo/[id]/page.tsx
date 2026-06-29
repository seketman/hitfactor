import Link from "next/link";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { CollapsibleHeading } from "@/components/CollapsibleHeading";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/Table";
import { createClient } from "@/lib/supabase/server";
import { getAmmoById, listAmmoHistory } from "@/lib/db/ammo";
import { updateAmmo } from "@/lib/actions/ammo";
import { formatDate } from "@/lib/utils";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}

export default async function AmmoDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { error } = await searchParams;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) notFound();

  const ammo = await getAmmoById(supabase, id);
  if (!ammo) notFound();

  const history = await listAmmoHistory(supabase, id);
  const totalRounds = history.reduce((acc, h) => acc + h.roundsFired, 0);

  return (
    <PageContainer className="max-w-3xl">
      <Link
        href="/ammo"
        className="mb-4 inline-block text-sm text-fg-muted hover:text-accent"
      >
        ← Tus municiones
      </Link>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{ammo.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
          <Badge tone={ammo.type === "reload" ? "info" : "default"}>
            {ammo.type === "reload" ? "recarga" : "factory"}
          </Badge>
          {ammo.caliber && <Badge tone="default">{ammo.caliber}</Badge>}
          {ammo.brand && <span>{ammo.brand}</span>}
          {ammo.bullet_weight_grains != null && (
            <span>{ammo.bullet_weight_grains}gr {ammo.bullet_type ?? ""}</span>
          )}
          {ammo.power_factor && (
            <Badge tone={ammo.power_factor === "Maj" ? "accent" : "default"}>
              {ammo.power_factor}
            </Badge>
          )}
          {ammo.power_factor_measured != null && (
            <span className="font-mono">
              PF {ammo.power_factor_measured}
            </span>
          )}
        </p>
      </header>

      {error && (
        <Alert tone="danger" className="mb-6">
          {error}
        </Alert>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <Card className="px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
            Tiros totales
          </p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
            {totalRounds.toLocaleString("es-AR")}
          </p>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
            Torneos
          </p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
            {history.length}
          </p>
        </Card>
      </div>

      <section className="mb-8">
        <details className="group">
          <CollapsibleHeading label="Editar datos de la munición" />
          <Card className="mt-3 p-6">
            <form action={updateAmmo} className="space-y-4">
              <input type="hidden" name="id" value={ammo.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Nombre"
                  name="name"
                  required
                  defaultValue={ammo.name}
                />
                <Select label="Tipo" name="type" required defaultValue={ammo.type}>
                  <option value="factory">Factory</option>
                  <option value="reload">Recarga</option>
                </Select>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Input
                  label="Calibre"
                  name="caliber"
                  defaultValue={ammo.caliber ?? ""}
                />
                <Input
                  label="Marca"
                  name="brand"
                  defaultValue={ammo.brand ?? ""}
                />
                <Input
                  label="Peso de punta (gr)"
                  name="bullet_weight_grains"
                  type="number"
                  step="0.1"
                  defaultValue={ammo.bullet_weight_grains ?? ""}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Input
                  label="Tipo de punta"
                  name="bullet_type"
                  defaultValue={ammo.bullet_type ?? ""}
                />
                <Input
                  label="Pólvora"
                  name="powder"
                  defaultValue={ammo.powder ?? ""}
                />
                <Input
                  label="Carga (gr)"
                  name="powder_charge_grains"
                  type="number"
                  step="0.01"
                  defaultValue={ammo.powder_charge_grains ?? ""}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  label="Factor declarado"
                  name="power_factor"
                  defaultValue={ammo.power_factor ?? ""}
                >
                  <option value="">— Sin declarar —</option>
                  <option value="Min">Min</option>
                  <option value="Maj">Maj</option>
                </Select>
                <Input
                  label="Factor medido (PF)"
                  name="power_factor_measured"
                  type="number"
                  step="0.1"
                  defaultValue={ammo.power_factor_measured ?? ""}
                  hint="peso (gr) × velocidad (fps) / 1000"
                />
              </div>
              <Input
                label="Notas"
                name="notes"
                defaultValue={ammo.notes ?? ""}
              />
              <Button type="submit">Guardar cambios</Button>
            </form>
          </Card>
        </details>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-fg-muted">
          Historial de uso
        </h2>
        {history.length === 0 ? (
          <Card className="p-10 text-center text-fg-muted">
            Todavía no asignaste esta munición a ningún match. Hacelo desde la
            página de tu participación, junto con el arma usada.
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>Fecha</TH>
                  <TH>Disciplina</TH>
                  <TH>Torneo</TH>
                  <TH>Arma</TH>
                  <TH className="text-right">Tiros</TH>
                </TR>
              </THead>
              <TBody>
                {history.map((h) => (
                  <TR key={h.matchEntryId}>
                    <TD className="whitespace-nowrap font-mono text-fg-muted">
                      {formatDate(h.matchDate)}
                    </TD>
                    <TD className="text-fg-muted">{h.disciplineName ?? "—"}</TD>
                    <TD>
                      <Link
                        href={`/matches/${h.matchId}/me`}
                        className="font-medium hover:text-accent"
                      >
                        {h.matchName}
                      </Link>
                    </TD>
                    <TD className="text-fg-muted">{h.firearmName}</TD>
                    <TD className="text-right font-mono">
                      {h.roundsFired.toLocaleString("es-AR")}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        )}
      </section>
    </PageContainer>
  );
}
