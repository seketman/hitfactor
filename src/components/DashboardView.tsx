import { getLocale, getTranslations } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
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
import { resolveImpersonation } from "@/lib/admin/impersonation";
import { DISCIPLINE, type DisciplineCode } from "@/lib/disciplines";

type DashboardT = Awaited<ReturnType<typeof getTranslations<"dashboard">>>;

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
  /**
   * Override de admin: UUID de un profile (= auth user id) para "ver el
   * dashboard como ese usuario". Se cargan TODOS sus shooters linkeados,
   * así la vista refleja exactamente lo que vería ese usuario al entrar
   * con su cuenta (incluyendo la consolidación multi-identidad).
   *
   * Se ignora silenciosamente si el usuario logueado no es admin o el
   * UUID no existe. El admin no cambia de sesión: las escrituras siguen
   * yendo a su propia cuenta.
   */
  asProfile?: string | null;
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
  asProfile = null,
}: DashboardViewProps) {
  const { supabase, user } = await requireUser();
  const t = await getTranslations("dashboard");
  const userId = user.id;
  const isConsolidated = disciplineCode === null;

  const [profile, myShooters, clubs] = await Promise.all([
    getProfile(supabase, userId),
    listMyShooters(supabase, userId),
    listClubs(supabase),
  ]);

  // Override de admin (`?asProfile=<uuid>`): sustituye la identidad activa
  // por la de otro usuario. Lo que sigue —entries, stats, historial, filtro
  // de división— opera sobre ese set efectivo, así que el admin ve
  // exactamente lo que vería ese usuario con su cuenta.
  //
  // El gate, la carga y el registro en `audit_log` viven juntos en
  // `lib/admin/impersonation.ts`; el porqué de cada decisión está ahí.
  const { profile: impersonatedProfile, shooters: impersonatedShooters } =
    await resolveImpersonation(
      supabase,
      { id: userId, isAdmin: profile?.is_admin === true },
      asProfile,
      { disciplineCode, divisionCode },
    );

  const isImpersonating = impersonatedProfile !== null;
  const activeProfile = isImpersonating ? impersonatedProfile : profile;
  const effectiveShooters = isImpersonating ? impersonatedShooters : myShooters;

  // Onboarding: si nunca claimó ninguna identidad, el dashboard no tiene
  // nada para mostrarle (todos los KPIs/historial dependen de tener al
  // menos un shooter linkeado). Lo redirigimos a `/matches`, donde la card
  // de sugerencias le presenta candidatos detectados por similitud. Solo
  // aplica al dashboard consolidado — en `/dashboard/[discipline]` el
  // usuario navega con intención y aceptamos mostrar el empty state.
  //
  // No redirigimos bajo impersonación: el admin puede estar diagnosticando
  // a un usuario sin shooters y necesita ver el empty state real.
  if (isConsolidated && !isImpersonating && effectiveShooters.length === 0) {
    const locale = await getLocale();
    redirect({ href: "/matches", locale });
  }

  const allEntries = await listEntriesByShooters(
    supabase,
    effectiveShooters.map((s) => s.id),
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

  // Bajo impersonación el dashboard mira el mundo desde la perspectiva del
  // usuario impersonado — incluyendo el "Hola, [display_name]" del header,
  // así el admin ve EXACTAMENTE lo que vería ese usuario. El banner deja
  // claro que es impersonación, no la sesión real del admin.
  const headerTitle = isConsolidated
    ? t("greeting", { name: activeProfile?.display_name ?? t("defaultShooter") })
    : divisionCode
      ? `${disciplineName ?? t("defaultDiscipline")} · ${divisionName ?? divisionCode}`
      : (disciplineName ?? t("defaultDiscipline"));

  const headerSubtitle = isConsolidated
    ? renderConsolidatedSubtitle(effectiveShooters, t)
    : renderDisciplineSubtitle(myEntries.length, divisionCode, t);

  // Lista de divisiones disponibles para el tab filter. Solo la mostramos
  // si el usuario tiene entries en más de una división dentro de esta
  // disciplina — con una sola, el filtro no agregaría nada.
  const divisionOptions = !isConsolidated
    ? collectDivisionOptions(disciplineEntries)
    : [];

  // URL para "Salir de impersonación": misma vista, sin `?asProfile`.
  // Preserva `division` para no perder el contexto del filtro activo.
  const exitImpersonationHref = isConsolidated
    ? "/dashboard"
    : `/dashboard/${disciplineCode}${divisionCode ? `?division=${encodeURIComponent(divisionCode)}` : ""}`;

  return (
    <PageContainer>
      {isImpersonating && impersonatedProfile && (
        <ImpersonationBanner
          profileName={impersonatedProfile.display_name}
          shooterCount={effectiveShooters.length}
          exitHref={exitImpersonationHref}
          t={t}
        />
      )}

      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{headerTitle}</h1>
        <p className="mt-1 text-sm text-fg-muted">{headerSubtitle}</p>
      </header>

      {!isConsolidated && divisionOptions.length > 1 && (
        <DivisionFilterTabs
          disciplineCode={disciplineCode}
          divisions={divisionOptions}
          activeDivision={divisionCode}
          asProfile={isImpersonating ? asProfile : null}
          t={t}
        />
      )}

      {myEntries.length > 0 ? (
        <>
          <Section title={t("yourResults")}>
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

          <Section title={t("yourHistory", { count: myEntries.length })}>
            <HistoryTable
              entries={myEntries}
              clubs={clubs}
              showDisciplineFilter={isConsolidated}
            />
          </Section>
        </>
      ) : (
        <EmptyState hasIdentities={effectiveShooters.length > 0} t={t} />
      )}
    </PageContainer>
  );
}

/**
 * Banner persistente arriba del dashboard cuando el admin está viendo
 * "como" otro usuario. Visual deliberadamente notorio (border accent +
 * bg soft) para que no se confunda con la sesión real del admin.
 */
function ImpersonationBanner({
  profileName,
  shooterCount,
  exitHref,
  t,
}: {
  profileName: string;
  shooterCount: number;
  exitHref: string;
  t: DashboardT;
}) {
  const identityText =
    shooterCount === 0
      ? t("impersonationNoIdentities")
      : shooterCount === 1
        ? t("impersonationOneIdentity")
        : t("impersonationManyIdentities", { count: shooterCount });

  return (
    <Card className="mb-6 border-accent/40 bg-accent-soft/40">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
        <span className="text-fg-muted">
          {t("impersonationBanner")}{" "}
          <strong className="text-fg">{profileName}</strong>{" "}
          <span className="text-fg-subtle">({identityText})</span>
        </span>
        <Link
          href={exitHref}
          className="rounded-md border border-border bg-surface-2 px-3 py-1 text-xs font-medium text-fg-muted hover:border-border-strong hover:text-fg"
        >
          {t("exit")}
        </Link>
      </div>
    </Card>
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
  asProfile = null,
  t,
}: {
  disciplineCode: string;
  divisions: Array<{ code: string; name: string }>;
  activeDivision: string | null;
  /**
   * Si hay impersonación activa, se preserva en los links de las tabs —
   * sino el admin pierde el contexto al cambiar de división.
   */
  asProfile?: string | null;
  t: DashboardT;
}) {
  const tabClass = (active: boolean) =>
    [
      "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
      active
        ? "border-accent bg-accent-soft text-fg"
        : "border-border bg-surface-2 text-fg-muted hover:border-border-strong hover:text-fg",
    ].join(" ");

  // Construye la URL con los query params correctos (division y/o asProfile).
  const hrefFor = (divisionCode: string | null): string => {
    const params = new URLSearchParams();
    if (divisionCode) params.set("division", divisionCode);
    if (asProfile) params.set("asProfile", asProfile);
    const qs = params.toString();
    return `/dashboard/${disciplineCode}${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="mb-8 flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wider text-fg-muted">
        {t("division")}
      </span>
      <Link href={hrefFor(null)} className={tabClass(activeDivision === null)}>
        {t("allDivisions")}
      </Link>
      {divisions.map((d) => (
        <Link
          key={d.code}
          href={hrefFor(d.code)}
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
  t: DashboardT,
): string {
  // Nota: aún cuando el tirador haya corrido el mismo torneo en 2
  // divisiones, este subtítulo cuenta entries (cada participación). Las
  // KPIs adentro sí deduplican por match. Si querés ver "torneos únicos",
  // está en la card "Torneos disputados" más abajo.
  return divisionCode
    ? t("participationsInDivision", { count: filteredEntriesCount })
    : t("participationsInDiscipline", { count: filteredEntriesCount });
}

/**
 * Estado del dashboard cuando el usuario no tiene aún match_entries:
 *  - Sin identidades: necesita encontrarse en algún match y hacer "Soy yo"
 *  - Con identidades pero sin entries: probablemente no se importaron sus matches
 */
function EmptyState({
  hasIdentities,
  t,
}: {
  hasIdentities: boolean;
  t: DashboardT;
}) {
  return (
    <Card className="p-10 text-center">
      {hasIdentities ? (
        <>
          <p className="font-medium">{t("emptyHasIdentitiesTitle")}</p>
          <p className="mt-2 text-sm text-fg-muted">
            {t("emptyHasIdentitiesBody")}
          </p>
          <Link href="/matches" className="mt-4 inline-block">
            <Button size="sm">{t("viewMatches")}</Button>
          </Link>
        </>
      ) : (
        <>
          <p className="font-medium">{t("emptyNoIdentitiesTitle")}</p>
          <p className="mt-2 text-sm text-fg-muted">
            {t("emptyNoIdentitiesBody")}
          </p>
          <Link href="/matches" className="mt-4 inline-block">
            <Button size="sm">{t("viewMatches")}</Button>
          </Link>
        </>
      )}
    </Card>
  );
}

function renderConsolidatedSubtitle(
  myShooters: Awaited<ReturnType<typeof listMyShooters>>,
  t: DashboardT,
) {
  if (myShooters.length === 0) {
    return t("consolidatedNoneLinked");
  }
  if (myShooters.length === 1) {
    return (
      <>
        {t("linkedWith")} <span className="text-fg">{myShooters[0]!.full_name}</span>
      </>
    );
  }
  return (
    <>
      {t("linkedWith")}{" "}
      <span
        className="text-fg"
        title={myShooters.map((s) => s.full_name).join(" · ")}
      >
        {myShooters[0]!.full_name}
      </span>{" "}
      <span className="text-fg-subtle">
        {t("extraIdentities", { count: myShooters.length - 1 })}
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

