import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { ComponentType, ReactNode, SVGProps } from "react";
import {
  ArrowDown,
  ArrowRight,
  BarChart3,
  Check,
  Crosshair,
  History,
  Layers,
  LineChart,
  ListChecks,
  TrendingUp,
  Upload,
  UserCheck,
  Users,
} from "lucide-react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { getDisciplineIcon } from "@/components/icons/discipline-icons";
import { DISCIPLINE } from "@/lib/disciplines";
import { cn } from "@/lib/utils";

/**
 * Landing pública de HitFactor — la ve cualquier visitante sin sesión que
 * entra a `/`. Presenta la app antes de invitar al registro/login.
 *
 * Server Component: todo es estático salvo el `ThemeToggle` (client) del
 * header. Usa los design tokens de la app (acento ámbar / latón) para que
 * la transición a las pantallas internas se sienta continua.
 *
 * El público objetivo incluye tiradores de edad variada con poco manejo de
 * sistemas — por eso el copy es concreto, sin jerga, y explica la app en
 * términos de lo que el usuario hace y obtiene.
 */
export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <HowItWorks />
        <SharedLibrary />
        <Features />
        <Disciplines />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

async function SiteHeader() {
  const t = await getTranslations("landing");
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Wordmark />
        <div className="flex items-center gap-2 sm:gap-3">
          <ThemeToggle className="hidden sm:inline-flex" />
          <Link
            href="/login"
            className="rounded-md px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
          >
            {t("signIn")}
          </Link>
          <CtaLink href="/signup" size="sm">
            {t("createAccount")}
          </CtaLink>
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

async function Hero() {
  const t = await getTranslations("landing");
  const benefits = [t("benefitFree"), t("benefitNoCard"), t("benefitYourData")];
  return (
    <section className="relative overflow-hidden">
      {/* Resplandor ámbar muy tenue desde el borde superior. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(ellipse_55%_55%_at_50%_0%,var(--color-accent-soft),transparent)]"
      />
      <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium uppercase tracking-wider text-fg-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            {t("heroBadge")}
          </span>

          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-fg sm:text-5xl sm:leading-[1.1]">
            {t("heroTitle")}
          </h1>

          <p className="mt-5 max-w-xl text-base leading-relaxed text-fg-muted sm:text-lg">
            {t("heroSubtitle")}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <CtaLink href="/signup" size="lg">
              {t("createAccountFree")}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </CtaLink>
            <CtaLink href="/login" variant="secondary" size="lg">
              {t("haveAccount")}
            </CtaLink>
          </div>

          <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-sm text-fg-muted">
            {benefits.map((item) => (
              <li key={item} className="flex items-center gap-2">
                <CheckDot />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <HeroPreview />
      </div>
    </section>
  );
}

/**
 * Maqueta del resumen del dashboard. Es decorativa (`aria-hidden`): muestra
 * cómo se ve la app sin exponer datos reales ni ruido para lectores de
 * pantalla. Replica los KPI cards y el chart de evolución reales.
 */
async function HeroPreview() {
  const t = await getTranslations("landing");
  const bars = [46, 56, 51, 63, 58, 69, 64, 74, 80];

  return (
    <div className="relative mx-auto w-full max-w-md lg:mx-0" aria-hidden>
      {/* Diana tenue de fondo — eco del logo. */}
      <TargetRings className="absolute -right-12 -top-14 h-56 w-56 text-border" />

      <div className="relative rounded-[10px] border border-border bg-surface p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-fg">{t("previewGreeting")}</p>
          <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-fg-muted">
            {t("previewConsolidated")}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <PreviewKpi label={t("previewMatches")} value="19" />
          <PreviewKpi label={t("previewAvgPct")} value="71.4" />
          <PreviewKpi label={t("previewBestPlace")} value="#2" />
          <PreviewKpi label={t("previewTrend")} value="+2.3%" tone="text-success" />
        </div>

        <div className="mt-2.5 rounded-md border border-border bg-surface-2 px-3 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-fg-muted">
            {t("previewPctEvolution")}
          </p>
          <div className="mt-3 flex h-20 items-end gap-1.5">
            {bars.map((h, i) => (
              <div
                key={i}
                className={cn(
                  "flex-1 rounded-sm",
                  i === bars.length - 1 ? "bg-accent" : "bg-accent/25",
                )}
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewKpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-2 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-fg-muted">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 font-mono text-lg font-semibold tabular-nums text-fg",
          tone,
        )}
      >
        {value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cómo funciona
// ---------------------------------------------------------------------------

const STEP_ICONS = [Upload, UserCheck, LineChart];

async function HowItWorks() {
  const t = await getTranslations("landing");
  const steps = STEP_ICONS.map((icon, i) => ({
    icon,
    title: t(`step${i + 1}Title` as "step1Title"),
    body: t(`step${i + 1}Body` as "step1Body"),
  }));
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
      <SectionHeading
        kicker={t("howKicker")}
        title={t("howTitle")}
        subtitle={t("howSubtitle")}
      />
      <ol className="mt-12 grid gap-5 md:grid-cols-3">
        {steps.map((step, i) => (
          <li
            key={step.title}
            className="rounded-[10px] border border-border bg-surface p-6"
          >
            <div className="flex items-center gap-3">
              <IconBadge icon={step.icon} />
              <span className="font-mono text-xs font-medium tracking-wider text-fg-subtle">
                {t("step", { n: String(i + 1).padStart(2, "0") })}
              </span>
            </div>
            <h3 className="mt-4 text-base font-semibold text-fg">
              {step.title}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Biblioteca compartida — el diferencial: un match se importa una vez y queda
// disponible para todos los tiradores que participaron.
// ---------------------------------------------------------------------------

async function SharedLibrary() {
  const t = await getTranslations("landing");
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
      <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div>
          <div className="flex items-center gap-3">
            <IconBadge icon={Users} />
            <p className="text-xs font-medium uppercase tracking-wider text-accent">
              {t("sharedKicker")}
            </p>
          </div>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
            {t("sharedTitle")}
          </h2>
          <p className="mt-3 text-base leading-relaxed text-fg-muted">
            {t("sharedBody")}
          </p>
        </div>
        <SharedLibraryDiagram />
      </div>
    </section>
  );
}

/** Diagrama: un match importado → disponible para todos. Decorativo. */
async function SharedLibraryDiagram() {
  const t = await getTranslations("landing");
  const shooters = [t("sharedDiagramYou"), "Marina G.", "Felipe D."];
  return (
    <div
      className="mx-auto w-full max-w-md rounded-[10px] border border-border bg-surface p-5 lg:mx-0"
      aria-hidden
    >
      <div className="flex items-center gap-3 rounded-md border border-accent/30 bg-accent-soft px-3.5 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-bg">
          <Upload className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-fg">
            {t("sharedDiagramMatchName")}
          </p>
          <p className="text-xs text-fg-muted">
            {t("sharedDiagramResults")}
          </p>
        </div>
      </div>

      <div className="flex justify-center py-2.5 text-fg-subtle">
        <ArrowDown className="h-4 w-4" />
      </div>

      <p className="text-[10px] font-medium uppercase tracking-wider text-fg-muted">
        {t("sharedDiagramAvailable")}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {shooters.map((name) => (
          <div
            key={name}
            className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-2"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
              <Check className="h-3 w-3" />
            </span>
            <span className="truncate text-xs font-medium text-fg">{name}</span>
          </div>
        ))}
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-2">
          <span className="truncate text-xs font-medium text-fg-subtle">
            {t("sharedDiagramMore")}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

const FEATURE_ICONS = [
  History,
  BarChart3,
  ListChecks,
  TrendingUp,
  Crosshair,
  Layers,
];

async function Features() {
  const t = await getTranslations("landing");
  const features = FEATURE_ICONS.map((icon, i) => ({
    icon,
    title: t(`feature${i + 1}Title` as "feature1Title"),
    body: t(`feature${i + 1}Body` as "feature1Body"),
  }));
  return (
    <section className="border-y border-border bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <SectionHeading
          kicker={t("featuresKicker")}
          title={t("featuresTitle")}
          subtitle={t("featuresSubtitle")}
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-[10px] border border-border bg-bg p-6 transition-colors hover:border-border-strong"
            >
              <IconBadge icon={feature.icon} />
              <h3 className="mt-4 text-base font-semibold text-fg">
                {feature.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">
                {feature.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Disciplinas
// ---------------------------------------------------------------------------

const DISCIPLINE_DATA = [
  { code: DISCIPLINE.IPSC, name: "IPSC", noteKey: "disciplineIpscNote" },
  { code: DISCIPLINE.STEEL, name: "Steel Challenge", noteKey: "disciplineSteelNote" },
  { code: DISCIPLINE.COMBAT, name: "Combat Solutions", noteKey: "disciplineCombatNote" },
  { code: DISCIPLINE.FBI, name: "Tiro FBI", noteKey: "disciplineFbiNote" },
] as const;

async function Disciplines() {
  const t = await getTranslations("landing");
  const disciplines = DISCIPLINE_DATA.map((d) => ({
    code: d.code,
    name: d.name,
    note: t(d.noteKey),
  }));
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
      <SectionHeading
        kicker={t("disciplinesKicker")}
        title={t("disciplinesTitle")}
        subtitle={t("disciplinesSubtitle")}
      />
      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {disciplines.map((discipline) => {
          const Icon = getDisciplineIcon(discipline.code);
          return (
            <div
              key={discipline.code}
              className="flex items-center gap-3.5 rounded-[10px] border border-border bg-surface p-5"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-fg">
                  {discipline.name}
                </p>
                <p className="text-xs text-fg-muted">{discipline.note}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// CTA final
// ---------------------------------------------------------------------------

async function FinalCta() {
  const t = await getTranslations("landing");
  return (
    <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28">
      <div className="relative overflow-hidden rounded-[14px] border border-border bg-surface px-6 py-14 text-center sm:px-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-full bg-[radial-gradient(ellipse_50%_70%_at_50%_0%,var(--color-accent-soft),transparent)]"
        />
        <div className="relative mx-auto max-w-xl">
          <h2 className="text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
            {t("ctaTitle")}
          </h2>
          <p className="mt-3 text-base leading-relaxed text-fg-muted">
            {t("ctaBody")}
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <CtaLink href="/signup" size="lg">
              {t("createAccountFree")}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </CtaLink>
            <CtaLink href="/login" variant="secondary" size="lg">
              {t("haveAccount")}
            </CtaLink>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

async function SiteFooter() {
  const t = await getTranslations("landing");
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <Wordmark />
          <p className="mt-2 text-sm text-fg-muted">
            {t("footerCreatedByBefore")}{" "}
            <span className="font-medium text-fg">Seketman</span>{" "}
            {t("footerCreatedByAfter")}
          </p>
        </div>
        <div className="flex items-center gap-5 text-sm">
          <Link
            href="/login"
            className="text-fg-muted transition-colors hover:text-fg"
          >
            {t("signIn")}
          </Link>
          <Link
            href="/signup"
            className="text-fg-muted transition-colors hover:text-fg"
          >
            {t("createAccount")}
          </Link>
        </div>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Piezas compartidas
// ---------------------------------------------------------------------------

function SectionHeading({
  kicker,
  title,
  subtitle,
}: {
  kicker: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="text-xs font-medium uppercase tracking-wider text-accent">
        {kicker}
      </p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
        {title}
      </h2>
      <p className="mt-3 text-base leading-relaxed text-fg-muted">{subtitle}</p>
    </div>
  );
}

function IconBadge({
  icon: Icon,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}) {
  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
      <Icon className="h-5 w-5" aria-hidden />
    </span>
  );
}

function CheckDot() {
  return (
    <span
      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
      aria-hidden
    >
      <svg viewBox="0 0 12 12" fill="none" className="h-2.5 w-2.5">
        <path
          d="M2.5 6.2 4.7 8.5 9.5 3.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <LogoMark className="h-7 w-7 text-accent" />
      <span className="text-base font-semibold tracking-tight text-fg">
        HitFactor
      </span>
    </Link>
  );
}

/** Diana de tres anillos — mismo motivo que el favicon de la app. */
function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="2" />
      <circle cx="16" cy="16" r="7.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="16" cy="16" r="2.5" fill="currentColor" />
    </svg>
  );
}

/** Anillos concéntricos para decoración de fondo. */
function TargetRings({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" fill="none" className={className} aria-hidden>
      {[94, 70, 46, 22].map((r) => (
        <circle
          key={r}
          cx="100"
          cy="100"
          r={r}
          stroke="currentColor"
          strokeWidth="1.5"
        />
      ))}
      <circle cx="100" cy="100" r="5" fill="currentColor" />
    </svg>
  );
}

/**
 * Link con apariencia de botón. La app anida `<Button>` dentro de `<Link>`,
 * pero acá preferimos un `<a>` solo — evita `<button>` dentro de `<a>` y deja
 * la landing 100% navegable con HTML semántico.
 */
function CtaLink({
  href,
  children,
  variant = "primary",
  size = "md",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = {
    sm: "h-9 px-3.5 text-sm",
    md: "h-10 px-4 text-sm",
    lg: "h-11 px-5 text-sm",
  };
  const variants = {
    primary:
      "bg-accent text-bg hover:bg-accent-strong focus-visible:ring-accent/40",
    secondary:
      "border border-border bg-surface text-fg hover:border-border-strong hover:bg-surface-2 focus-visible:ring-border-strong",
  };
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        sizes[size],
        variants[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}
