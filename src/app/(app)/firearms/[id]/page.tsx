import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/Table";
import { createClient } from "@/lib/supabase/server";
import {
  getFirearmById,
  listFirearmHistory,
  listFirearmUsageLog,
} from "@/lib/db/firearms";
import { listMyAmmo } from "@/lib/db/ammo";
import {
  createFirearmUsage,
  deleteFirearmUsage,
  updateFirearm,
} from "@/lib/actions/firearms";
import { formatDate } from "@/lib/utils";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}

/**
 * Item unificado del historial — sirve tanto para matches (origen torneo)
 * como para sesiones de práctica (origen manual). Se hace merge in-memory
 * y se ordena por fecha desc.
 */
type HistoryItem =
  | {
      kind: "match";
      key: string;
      date: string;
      label: string;
      href: string;
      discipline: string | null;
      rounds: number;
      ammoName: string | null;
      logId: null;
    }
  | {
      kind: "session";
      key: string;
      date: string;
      label: string;
      href: null;
      discipline: null;
      rounds: number;
      ammoName: string | null;
      logId: string;
      notes: string | null;
    };

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

  const [matchHistory, usageLogs, myAmmo] = await Promise.all([
    listFirearmHistory(supabase, id),
    listFirearmUsageLog(supabase, id),
    listMyAmmo(supabase, userData.user.id),
  ]);

  const matchRounds = matchHistory.reduce((acc, h) => acc + h.roundsFired, 0);
  const sessionRounds = usageLogs.reduce((acc, l) => acc + l.rounds_fired, 0);
  const totalRounds = matchRounds + sessionRounds;

  // Merge cronológico: un único historial ordenado por fecha desc, con
  // badge "Origen" que distingue match vs práctica.
  const history: HistoryItem[] = [
    ...matchHistory.map(
      (h): HistoryItem => ({
        kind: "match",
        key: `match:${h.matchEntryId}`,
        date: h.matchDate,
        label: h.matchName,
        href: `/matches/${h.matchId}/me`,
        discipline: h.disciplineName,
        rounds: h.roundsFired,
        ammoName: null,
        logId: null,
      }),
    ),
    ...usageLogs.map(
      (l): HistoryItem => ({
        kind: "session",
        key: `session:${l.id}`,
        date: l.used_on,
        label: l.notes ?? "Práctica",
        href: null,
        discipline: null,
        rounds: l.rounds_fired,
        ammoName: l.ammunition_types?.name ?? null,
        logId: l.id,
        notes: l.notes,
      }),
    ),
  ].sort((a, b) => b.date.localeCompare(a.date));

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

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <KpiCard label="Tiros totales" value={totalRounds.toLocaleString("es-AR")} />
        <KpiCard label="Torneos" value={String(matchHistory.length)} />
        <KpiCard label="Prácticas" value={String(usageLogs.length)} />
      </div>

      <section className="mb-8">
        <details className="group">
          <CollapsibleHeading label="Editar datos del arma" />
          <Card className="mt-3 p-6">
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
        </details>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-fg-muted">
          Historial de uso
        </h2>
        {history.length === 0 ? (
          <Card className="p-10 text-center text-fg-muted">
            Todavía no hay sesiones registradas ni asignaciones a matches.
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>Fecha</TH>
                  <TH>Origen</TH>
                  <TH>Detalle</TH>
                  <TH>Munición</TH>
                  <TH className="text-right">Tiros</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {history.map((h) => (
                  <TR key={h.key}>
                    <TD className="whitespace-nowrap font-mono text-fg-muted">
                      {formatDate(h.date)}
                    </TD>
                    <TD>
                      {h.kind === "match" ? (
                        <Badge tone="accent">Match</Badge>
                      ) : (
                        <Badge tone="default">Práctica</Badge>
                      )}
                    </TD>
                    <TD>
                      {h.href ? (
                        <Link
                          href={h.href}
                          className="font-medium hover:text-accent"
                        >
                          {h.label}
                        </Link>
                      ) : (
                        <span className="text-fg">{h.label}</span>
                      )}
                      {h.discipline && (
                        <div className="text-xs text-fg-subtle">
                          {h.discipline}
                        </div>
                      )}
                    </TD>
                    <TD className="text-fg-muted">{h.ammoName ?? "—"}</TD>
                    <TD className="text-right font-mono">
                      {h.rounds.toLocaleString("es-AR")}
                    </TD>
                    <TD>
                      {h.kind === "session" && (
                        <form action={deleteFirearmUsage}>
                          <input type="hidden" name="id" value={h.logId} />
                          <input
                            type="hidden"
                            name="firearm_id"
                            value={firearm.id}
                          />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            className="text-danger hover:text-danger"
                          >
                            Borrar
                          </Button>
                        </form>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        )}
      </section>

      <section>
        <details className="group">
          <CollapsibleHeading label="Registrar sesión de práctica" />
          <Card className="mt-3 p-6">
          <form action={createFirearmUsage} className="space-y-4">
            <input type="hidden" name="firearm_id" value={firearm.id} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                label="Fecha"
                name="used_on"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
              <Input
                label="Tiros disparados"
                name="rounds_fired"
                type="number"
                min={1}
                required
                placeholder="100"
              />
              {myAmmo.length > 0 ? (
                <Select label="Munición (opcional)" name="ammunition_type_id" defaultValue="">
                  <option value="">— Sin especificar —</option>
                  {myAmmo.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.caliber ? ` (${a.caliber})` : ""}
                    </option>
                  ))}
                </Select>
              ) : (
                <div className="text-xs text-fg-subtle">
                  Sin catálogo de munición.{" "}
                  <Link
                    href="/ammo"
                    className="text-accent hover:underline"
                  >
                    Agregar
                  </Link>{" "}
                  para asociar al consumo.
                </div>
              )}
            </div>
            <Input
              label="Notas (opcional)"
              name="notes"
              placeholder="Ej: entrenamiento de draw, polígono TFALP"
            />
            <Button type="submit">Registrar</Button>
          </form>
          </Card>
        </details>
      </section>
    </PageContainer>
  );
}

/**
 * Heading clicable que actúa de toggle del `<details>` padre. Mantiene la
 * tipografía (uppercase + tracking) de las otras secciones para que la
 * pantalla se sienta consistente; el único agregado visual es el chevron
 * que rota 180° cuando el contenedor está abierto.
 */
function CollapsibleHeading({ label }: { label: string }) {
  return (
    <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium uppercase tracking-wider text-fg-muted hover:text-fg [&::-webkit-details-marker]:hidden">
      <ChevronDown
        className="h-4 w-4 transition-transform group-open:rotate-180"
        aria-hidden
      />
      {label}
    </summary>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
        {label}
      </p>
      <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
        {value}
      </p>
    </Card>
  );
}
