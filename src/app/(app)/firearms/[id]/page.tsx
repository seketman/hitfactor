import Link from "next/link";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/Table";
import { createClient } from "@/lib/supabase/server";
import {
  getFirearmById,
  listFirearmHistory,
} from "@/lib/db/firearms";
import { updateFirearm } from "@/lib/actions/firearms";
import { formatDate } from "@/lib/utils";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}

export default async function FirearmDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { error } = await searchParams;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) notFound();

  const firearm = await getFirearmById(supabase, id);
  if (!firearm) notFound();

  const history = await listFirearmHistory(supabase, id);
  const totalRounds = history.reduce((acc, h) => acc + h.roundsFired, 0);

  return (
    <PageContainer className="max-w-3xl">
      <Link
        href="/firearms"
        className="mb-4 inline-block text-sm text-fg-muted hover:text-accent"
      >
        ← Tus armas
      </Link>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{firearm.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
          {firearm.brand && <span>{firearm.brand}</span>}
          {firearm.model && <span>{firearm.model}</span>}
          {firearm.caliber && <Badge tone="default">{firearm.caliber}</Badge>}
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
            Torneos disputados
          </p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
            {history.length}
          </p>
        </Card>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-fg-muted">
          Historial de uso
        </h2>
        {history.length === 0 ? (
          <Card className="p-10 text-center text-fg-muted">
            Todavía no asignaste esta arma a ningún match. Hacelo desde la
            página de tu participación en cualquier torneo.
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>Fecha</TH>
                  <TH>Disciplina</TH>
                  <TH>Torneo</TH>
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

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-fg-muted">
          Editar
        </h2>
        <Card className="p-6">
          <form action={updateFirearm} className="space-y-4">
            <input type="hidden" name="id" value={firearm.id} />
            <Input label="Nombre" name="name" required defaultValue={firearm.name} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Input label="Marca" name="brand" defaultValue={firearm.brand ?? ""} />
              <Input label="Modelo" name="model" defaultValue={firearm.model ?? ""} />
              <Input
                label="Calibre"
                name="caliber"
                defaultValue={firearm.caliber ?? ""}
              />
            </div>
            <Input label="Notas" name="notes" defaultValue={firearm.notes ?? ""} />
            <Button type="submit">Guardar cambios</Button>
          </form>
        </Card>
      </section>
    </PageContainer>
  );
}
