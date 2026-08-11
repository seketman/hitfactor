import { Link } from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
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
  const t = await getTranslations("firearms");
  const tc = await getTranslations("common");
  const { error, new: showNew } = await searchParams;

  const { supabase, user } = await requireUser();
  const stats = await listFirearmUsageStats(supabase, user.id);

  return (
    <PageContainer className="max-w-3xl">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-fg-muted">{t("subtitle")}</p>
        </div>
        {!showNew && stats.length > 0 && (
          <Link href="/firearms?new=1">
            <Button>{t("add")}</Button>
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
            {t("newHeading")}
          </h2>
          <form action={createFirearm} className="space-y-4">
            <Input
              label={tc("fieldName")}
              name="name"
              required
              placeholder={t("fieldNamePlaceholder")}
            />
            {/* Los placeholders de marca/modelo/calibre son ejemplos de
                producto, no prosa: "Glock" y "9x19" se escriben igual en
                los dos idiomas. */}
            <div className="grid gap-4 sm:grid-cols-3">
              <Input label={tc("fieldBrand")} name="brand" placeholder="Glock" />
              <Input label={t("fieldModel")} name="model" placeholder="17 Gen 5" />
              <Input label={tc("fieldCaliber")} name="caliber" placeholder="9x19" />
            </div>
            <Input
              label={tc("fieldNotes")}
              name="notes"
              placeholder={tc("fieldNotesPlaceholder")}
            />
            <div className="flex gap-2">
              <Button type="submit">{tc("save")}</Button>
              {stats.length > 0 && (
                <Link href="/firearms">
                  <Button type="button" variant="ghost">
                    {tc("cancel")}
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
                {/* Los conteos van por ICU y no concatenados a mano. El
                    plural del inglés no se resuelve con `s` condicional
                    ("match" hace "matches"), y el `#` de ICU además formatea
                    el número en el locale activo — antes era
                    `toLocaleString("es-AR")` fijo, así que un usuario en
                    inglés veía "1.500" con el separador español. */}
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
                <form action={deleteFirearm}>
                  <input type="hidden" name="id" value={firearm.id} />
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
