import Link from "next/link";
import { redirect } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { HistoryTable } from "@/components/HistoryTable";
import { StatsOverview } from "@/components/StatsOverview";
import { requireUser } from "@/lib/supabase/require-user";
import { getProfile } from "@/lib/db/profiles";
import { listMyShooters } from "@/lib/db/shooters";
import { listClubs } from "@/lib/db/clubs";
import {
  getDivisionSizes,
  listEntriesByShooters,
  listMyStageResultsForEntries,
} from "@/lib/db/matches";
import { computeShooterStats } from "@/lib/stats/shooter-stats";
import { DISCIPLINE, type DisciplineCode } from "@/lib/disciplines";

interface DashboardViewProps {
  /** Filtra entries y matches a esta disciplina. Null = vista consolidada. */
  disciplineCode: DisciplineCode | null;
  /** Nombre legible de la disciplina (cuando se filtra). */
  disciplineName?: string | null;
  /**
   * Filtra entries a una división específica dentro de la disciplina. Solo
   * aplica cuando `disciplineCode` está seteado — `division` solo tiene
   * sentido dentro de una disciplina (los codes se solapan entre IPSC y
   * FBI: `PIS`, `PCC`).
   */
  divisionCode?: string | null;
  /** Nombre legible de la división (cuando se filtra). */
  divisionName?: string | null;
}

/**
 * Vista del dashboard. Server Component que se reutiliza desde dos rutas:
 *  - `/dashboard` (consolidado, disciplineCode=null): muestra todas las
 *    disciplinas agregadas
 *  - `/dashboard/[discipline]`: filtra a una disciplina específica;
 *    opcional `?division=<code>` filtra además a una división.
 *
 * Foco: información del tirador (KPIs + historial). El listado de matches
 * vive en `/matches` y el catálogo de armas en `/firearms`.
 */
export async function DashboardView({
  disciplineCode,
  disciplineName,
  divisionCode = null,
  divisionName = null,
}: DashboardViewProps) {
  const { supabase, user } = await requireUser();
  const userId = user.id;
  const isConsolidated = disciplineCode === null;

  const [profile, myShooters, clubs] = await Promise.all([
    getProfile(supabase, userId),
    listMyShooters(supabase, userId),
    listClubs(supabase),
  ]);

  // Onboarding: si nunca claimó ninguna identidad, el dashboard no tiene
  // nada para mostrarle (todos los KPIs/historial dependen de tener al
  // menos un shooter linkeado). Lo redirigimos a `/matches`, donde la card
  // de sugerencias le presenta candidatos detectados por similitud. Solo
  // aplica al dashboard consolidado — en `/dashboard/[discipline]` el
  // usuario navega con intención y aceptamos mostrar el empty state.
  if (isConsolidated && myShooters.length === 0) {
    redirect("/matches");
  }

  const allEntries = await listEntriesByShooters(
    supabase,
    myShooters.map((s) => s.id),
  );

  // Entries dentro de la disciplina activa (o todos, si consolidado). Se
  // usan para armar la lista de divisiones disponibles en el filtro tabs.
  const disciplineEntries = isConsolidated
    ? allEntries
    : allEntries.filter(
        (e) => e.matches?.disciplines?.code === disciplineCode,
      );

  // Entries que efectivamente alimentan KPIs e historial. Si hay división
  // filtrada, además acotamos por ella.
  const myEntries = divisionCode
    ? disciplineEntries.filter((e) => e.divisions?.code === divisionCode)
    : disciplineEntries;

  const uniqueMatchIds = Array.from(
    new Set(myEntries.map((e) => e.matches?.id).filter((id): id is string => !!id)),
  );
  const [divisionSizes, myStageResults] = await Promise.all([
    getDivisionSizes(supabase, uniqueMatchIds),
    listMyStageResultsForEntries(
      supabase,
      myEntries.map((e) => e.id),
    ),
  ]);

  const headerTitle = isConsolidated
    ? `Hola, ${profile?.display_name ?? "tirador"}`
    : divisionCode
      ? `${disciplineName ?? "Disciplina"} · ${divisionName ?? divisionCode}`
      : (disciplineName ?? "Disciplina");

  const headerSubtitle = isConsolidated
    ? renderConsolidatedSubtitle(myShooters)
    : renderDisciplineSubtitle(myEntries.length, divisionCode);

  // Lista de divisiones disponibles para el tab filter. Solo la mostramos
  // si el usuario tiene entries en más de una división dentro de esta
  // disciplina — con una sola, el filtro no agregaría nada.
  const divisionOptions = !isConsolidated
    ? collectDivisionOptions(disciplineEntries)
    : [];

  return (
    <PageContainer>
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{headerTitle}</h1>
        <p className="mt-1 text-sm text-fg-muted">{headerSubtitle}</p>
      </header>

      {!isConsolidated && divisionOptions.length > 1 && (
        <DivisionFilterTabs
          disciplineCode={disciplineCode}
          divisions={divisionOptions}
          activeDivision={divisionCode}
        />
      )}

      {myEntries.length > 0 ? (
        <>
          <Section title="Tus resultados">
            <StatsOverview
              stats={computeShooterStats(myEntries, {
                divisionSizes,
                stageResults: myStageResults,
              })}
              primaryMetric={
                disciplineCode === DISCIPLINE.FBI ? "hits" : "percentage"
              }
            />
          </Section>

          <Section title={`Tu historial (${myEntries.length})`}>
            <HistoryTable
              entries={myEntries}
              clubs={clubs}
              showDisciplineFilter={isConsolidated}
            />
          </Section>
        </>
      ) : (
        <EmptyState hasIdentities={myShooters.length > 0} />
      )}
    </PageContainer>
  );
}

/**
 * Tabs para filtrar el dashboard a una sola división dentro de la
 * disciplina activa. "Todas" navega a la URL sin `?division`.
 */
function DivisionFilterTabs({
  disciplineCode,
  divisions,
  activeDivision,
}: {
  disciplineCode: string;
  divisions: Array<{ code: string; name: string }>;
  activeDivision: string | null;
}) {
  const tabClass = (active: boolean) =>
    [
      "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
      active
        ? "border-accent bg-accent-soft text-fg"
        : "border-border bg-surface-2 text-fg-muted hover:border-border-strong hover:text-fg",
    ].join(" ");

  return (
    <div className="mb-8 flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wider text-fg-muted">
        División
      </span>
      <Link
        href={`/dashboard/${disciplineCode}`}
        className={tabClass(activeDivision === null)}
      >
        Todas
      </Link>
      {divisions.map((d) => (
        <Link
          key={d.code}
          href={`/dashboard/${disciplineCode}?division=${encodeURIComponent(d.code)}`}
          title={d.name}
          className={tabClass(activeDivision === d.code)}
        >
          {d.code}
        </Link>
      ))}
    </div>
  );
}

/**
 * Deriva la lista de divisiones (code+name) presentes en los entries del
 * usuario para esta disciplina, ordenada alfabéticamente por code.
 */
function collectDivisionOptions(
  entries: Awaited<ReturnType<typeof listEntriesByShooters>>,
): Array<{ code: string; name: string }> {
  const map = new Map<string, string>();
  for (const e of entries) {
    const code = e.divisions?.code;
    if (!code) continue;
    if (!map.has(code)) map.set(code, e.divisions?.name ?? code);
  }
  return [...map.entries()]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

function renderDisciplineSubtitle(
  filteredEntriesCount: number,
  divisionCode: string | null,
): string {
  // Nota: aún cuando el tirador haya corrido el mismo torneo en 2
  // divisiones, este subtítulo cuenta entries (cada participación). Las
  // KPIs adentro sí deduplican por match. Si querés ver "torneos únicos",
  // está en la card "Torneos disputados" más abajo.
  const palabra = filteredEntriesCount === 1 ? "participación" : "participaciones";
  return divisionCode
    ? `${filteredEntriesCount} ${palabra} en esta división`
    : `${filteredEntriesCount} ${palabra} en esta disciplina`;
}

/**
 * Estado del dashboard cuando el usuario no tiene aún match_entries:
 *  - Sin identidades: necesita encontrarse en algún match y hacer "Soy yo"
 *  - Con identidades pero sin entries: probablemente no se importaron sus matches
 */
function EmptyState({ hasIdentities }: { hasIdentities: boolean }) {
  return (
    <Card className="p-10 text-center">
      {hasIdentities ? (
        <>
          <p className="font-medium">Tus estadísticas van a aparecer acá</p>
          <p className="mt-2 text-sm text-fg-muted">
            En cuanto se importe un match en el que hayas participado, vas a
            ver tus resultados, estadísticas e historial.
          </p>
          <Link href="/matches" className="mt-4 inline-block">
            <Button size="sm">Ver matches</Button>
          </Link>
        </>
      ) : (
        <>
          <p className="font-medium">Asociá una participación a tu cuenta</p>
          <p className="mt-2 text-sm text-fg-muted">
            Buscá tu nombre en el ranking de algún match y hacé click en
            “Soy yo” para empezar a ver tus estadísticas acá.
          </p>
          <Link href="/matches" className="mt-4 inline-block">
            <Button size="sm">Ver matches</Button>
          </Link>
        </>
      )}
    </Card>
  );
}

function renderConsolidatedSubtitle(
  myShooters: Awaited<ReturnType<typeof listMyShooters>>,
) {
  if (myShooters.length === 0) {
    return "Todavía no asociaste ninguna participación a tu cuenta. Buscá tu nombre en algún match para hacerlo.";
  }
  if (myShooters.length === 1) {
    return (
      <>
        Asociado con <span className="text-fg">{myShooters[0]!.full_name}</span>
      </>
    );
  }
  return (
    <>
      Asociado con{" "}
      <span
        className="text-fg"
        title={myShooters.map((s) => s.full_name).join(" · ")}
      >
        {myShooters[0]!.full_name}
      </span>{" "}
      <span className="text-fg-subtle">
        (+{myShooters.length - 1}{" "}
        {myShooters.length - 1 === 1 ? "identidad" : "identidades"})
      </span>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-fg-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

