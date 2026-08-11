import { Link } from "@/i18n/navigation";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
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
  const locale = await getLocale();
  const t = await getTranslations("ammo");
  const tc = await getTranslations("common");
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
        ← {t("title")}
      </Link>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{ammo.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
          <Badge tone={ammo.type === "reload" ? "info" : "default"}>
            {ammo.type === "reload" ? t("typeReload") : t("typeFactory")}
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
            {tc("kpiTotalRounds")}
          </p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
            {totalRounds.toLocaleString(locale)}
          </p>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
            {tc("kpiMatches")}
          </p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
            {history.length}
          </p>
        </Card>
      </div>

      <section className="mb-8">
        <details className="group">
          <CollapsibleHeading label={t("editHeading")} />
          <Card className="mt-3 p-6">
            <form action={updateAmmo} className="space-y-4">
              <input type="hidden" name="id" value={ammo.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label={tc("fieldName")}
                  name="name"
                  required
                  defaultValue={ammo.name}
                />
                <Select label={t("fieldType")} name="type" required defaultValue={ammo.type}>
                  <option value="factory">{t("optionFactory")}</option>
                  <option value="reload">{t("optionReload")}</option>
                </Select>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Input
                  label={tc("fieldCaliber")}
                  name="caliber"
                  defaultValue={ammo.caliber ?? ""}
                />
                <Input
                  label={tc("fieldBrand")}
                  name="brand"
                  defaultValue={ammo.brand ?? ""}
                />
                <Input
                  label={t("fieldBulletWeight")}
                  name="bullet_weight_grains"
                  type="number"
                  step="0.1"
                  defaultValue={ammo.bullet_weight_grains ?? ""}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Input
                  label={t("fieldBulletType")}
                  name="bullet_type"
                  defaultValue={ammo.bullet_type ?? ""}
                />
                <Input
                  label={t("fieldPowder")}
                  name="powder"
                  defaultValue={ammo.powder ?? ""}
                />
                <Input
                  label={t("fieldPowderCharge")}
                  name="powder_charge_grains"
                  type="number"
                  step="0.01"
                  defaultValue={ammo.powder_charge_grains ?? ""}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  label={t("fieldPowerFactor")}
                  name="power_factor"
                  defaultValue={ammo.power_factor ?? ""}
                >
                  <option value="">{t("powerFactorNone")}</option>
                  <option value="Min">Min</option>
                  <option value="Maj">Maj</option>
                </Select>
                <Input
                  label={t("fieldPowerFactorMeasured")}
                  name="power_factor_measured"
                  type="number"
                  step="0.1"
                  defaultValue={ammo.power_factor_measured ?? ""}
                  hint={t("powerFactorHint")}
                />
              </div>
              <Input
                label={tc("fieldNotes")}
                name="notes"
                defaultValue={ammo.notes ?? ""}
              />
              <Button type="submit">{tc("saveChanges")}</Button>
            </form>
          </Card>
        </details>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-fg-muted">
          {tc("historyHeading")}
        </h2>
        {history.length === 0 ? (
          <Card className="p-10 text-center text-fg-muted">
            {t("historyEmpty")}
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>{tc("colDate")}</TH>
                  <TH>{t("colDiscipline")}</TH>
                  <TH>{t("colMatch")}</TH>
                  <TH>{t("colFirearm")}</TH>
                  <TH className="text-right">{tc("colRounds")}</TH>
                </TR>
              </THead>
              <TBody>
                {history.map((h) => (
                  <TR key={h.matchEntryId}>
                    <TD className="whitespace-nowrap font-mono text-fg-muted">
                      {formatDate(h.matchDate, locale)}
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
                      {h.roundsFired.toLocaleString(locale)}
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
