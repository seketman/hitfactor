import { Link } from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
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
  const t = await getTranslations("ammo");
  const tc = await getTranslations("common");
  const { error, new: showNew } = await searchParams;

  const { supabase, user } = await requireUser();
  const stats = await listAmmoUsageStats(supabase, user.id);

  return (
    <PageContainer className="max-w-3xl">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">{t("subtitle")}</p>
        </div>
        {!showNew && stats.length > 0 && (
          <Link href="/ammo?new=1">
            <Button>{t("add")}</Button>
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
                      {ammo.type === "reload" ? t("typeReload") : t("typeFactory")}
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
                {/* Mismo criterio que en firearms: ICU para los conteos.
                    Formatea el número en el locale activo y resuelve el
                    plural inglés, que no sale con una `s` condicional. */}
                <div className="text-right text-sm">
                  <p className="font-mono text-fg">
                    {tc("roundCount", { count: totalRounds })}
                  </p>
                  <p className="text-xs text-fg-subtle">
                    {tc("matchCount", { count: totalMatches })}
                    {lastUsedDate &&
                      ` · ${tc("lastUsed", { date: formatDate(lastUsedDate, locale) })}`}
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
                    {tc("delete")}
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

async function NewAmmoForm({ cancelable }: { cancelable: boolean }) {
  const t = await getTranslations("ammo");
  const tc = await getTranslations("common");
  return (
    <Card className="mb-6 p-6">
      <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-fg-muted">
        {t("newHeading")}
      </h2>
      <form action={createAmmo} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={tc("fieldName")}
            name="name"
            required
            placeholder={t("fieldNamePlaceholder")}
          />
          <Select label={t("fieldType")} name="type" required defaultValue="factory">
            <option value="factory">{t("optionFactory")}</option>
            <option value="reload">{t("optionReload")}</option>
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label={tc("fieldCaliber")} name="caliber" placeholder="9x19" />
          <Input label={tc("fieldBrand")} name="brand" placeholder="Hornady" />
          <Input
            label={t("fieldBulletWeight")}
            name="bullet_weight_grains"
            type="number"
            step="0.1"
            placeholder="124"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            label={t("fieldBulletType")}
            name="bullet_type"
            placeholder={t("fieldBulletTypePlaceholder")}
          />
          <Input label={t("fieldPowder")} name="powder" placeholder="Vihtavuori N320" />
          <Input
            label={t("fieldPowderCharge")}
            name="powder_charge_grains"
            type="number"
            step="0.01"
            placeholder="4.3"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label={t("fieldPowerFactor")} name="power_factor" defaultValue="">
            <option value="">{t("powerFactorNone")}</option>
            <option value="Min">Min</option>
            <option value="Maj">Maj</option>
          </Select>
          <Input
            label={t("fieldPowerFactorMeasured")}
            name="power_factor_measured"
            type="number"
            step="0.1"
            placeholder="139.5"
            hint={t("powerFactorHint")}
          />
        </div>
        <Input
          label={tc("fieldNotes")}
          name="notes"
          placeholder={tc("fieldNotesPlaceholder")}
        />
        <div className="flex gap-2">
          <Button type="submit">{tc("save")}</Button>
          {cancelable && (
            <Link href="/ammo">
              <Button type="button" variant="ghost">
                {tc("cancel")}
              </Button>
            </Link>
          )}
        </div>
      </form>
    </Card>
  );
}
