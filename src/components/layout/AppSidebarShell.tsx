"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Trophy,
  LayoutDashboard,
  Crosshair,
  History,
  Info,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { getDisciplineIcon } from "@/components/icons/discipline-icons";
import { cn } from "@/lib/utils";

const COLLAPSE_STORAGE_KEY = "hitfactor:sidebar-collapsed";

interface DisciplineEntry {
  code: string;
  name: string;
  count: number;
}

interface AppSidebarShellProps {
  userName: string;
  /** Email de la cuenta — se muestra en el tooltip del nombre. */
  userEmail?: string | null;
  /** Fecha de creación de la cuenta (ISO YYYY-MM-DD). Tooltip-only. */
  memberSince?: string | null;
  disciplines: DisciplineEntry[];
  /** Versión de la app (de package.json) — uso interno, render discreto. */
  appVersion: string;
}

/**
 * Sidebar tipo Claude web: principal en desktop, drawer en mobile.
 *
 * Estructura:
 *  - Disciplinas (header) → sub-items por disciplina participada + Consolidado.
 *  - Armas, Importar (top-level).
 *  - Footer: ThemeToggle + nombre + Salir.
 *
 * Persiste el estado collapsed en localStorage.
 */
export function AppSidebarShell({
  userName,
  userEmail,
  memberSince,
  disciplines,
  appVersion,
}: AppSidebarShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Tooltip multilínea para el nombre del usuario. Browsers respetan \n
  // en el atributo title (Chrome, Safari, Firefox lo renderizan con saltos
  // de línea reales).
  const userTooltip = [
    userName,
    userEmail || null,
    memberSince ? `Miembro desde ${memberSince}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // Hidratar estado desde localStorage solo en cliente.
  useEffect(() => {
    const stored = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
    if (stored === "1") setCollapsed(true);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  // Cerrar drawer mobile al navegar.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Top bar mobile (solo visible <md) */}
      <div className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur md:hidden print:hidden">
        <button
          type="button"
          aria-label="Abrir menú"
          onClick={() => setMobileOpen(true)}
          className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-accent" aria-hidden />
          <span className="font-semibold tracking-tight">HitFactor</span>
        </Link>
        <ThemeToggle />
      </div>

      {/* Drawer overlay mobile */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Cerrar menú"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border bg-bg transition-[width,transform] md:sticky md:top-0 md:h-screen md:translate-x-0 print:hidden",
          collapsed ? "md:w-16" : "md:w-60",
          mobileOpen ? "w-64 translate-x-0" : "w-64 -translate-x-full md:translate-x-0",
        )}
      >
        {/* Header del sidebar */}
        <div
          className={cn(
            "flex h-14 items-center border-b border-border",
            collapsed ? "justify-center px-2" : "justify-between px-4",
          )}
        >
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-accent" aria-hidden />
            {!collapsed && <span className="font-semibold tracking-tight">HitFactor</span>}
          </Link>
          {/* Botón collapse desktop */}
          <button
            type="button"
            aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
            onClick={() => setCollapsed((c) => !c)}
            className="hidden rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg md:block"
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" aria-hidden />
            ) : (
              <ChevronLeft className="h-4 w-4" aria-hidden />
            )}
          </button>
          {/* Botón cerrar mobile */}
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setMobileOpen(false)}
            className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg md:hidden"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-4">
          {!collapsed && (
            <p className="mb-1 px-3 text-xs font-medium uppercase tracking-wider text-fg-subtle">
              Disciplinas
            </p>
          )}
          <ul className="mb-4 space-y-0.5">
            {disciplines.map((d) => {
              const Icon = getDisciplineIcon(d.code);
              return (
                <NavItem
                  key={d.code}
                  href={`/dashboard/${d.code}`}
                  icon={<Icon className="h-4 w-4" aria-hidden />}
                  label={d.name}
                  count={d.count}
                  active={pathname === `/dashboard/${d.code}`}
                  collapsed={collapsed}
                />
              );
            })}
            <NavItem
              href="/dashboard"
              icon={<LayoutDashboard className="h-4 w-4" aria-hidden />}
              label="Consolidado"
              active={pathname === "/dashboard"}
              collapsed={collapsed}
            />
          </ul>

          <ul className="space-y-0.5 border-t border-border pt-4">
            <NavItem
              href="/matches"
              icon={<Trophy className="h-4 w-4" aria-hidden />}
              label="Matches"
              active={
                pathname === "/matches" || pathname.startsWith("/matches/")
              }
              collapsed={collapsed}
            />
            <NavItem
              href="/firearms"
              icon={<Crosshair className="h-4 w-4" aria-hidden />}
              label="Armas"
              active={pathname.startsWith("/firearms")}
              collapsed={collapsed}
            />
            <NavItem
              href="/ammo"
              icon={<Package className="h-4 w-4" aria-hidden />}
              label="Municiones"
              active={pathname.startsWith("/ammo")}
              collapsed={collapsed}
            />
            <NavItem
              href="/activity"
              icon={<History className="h-4 w-4" aria-hidden />}
              label="Actividad"
              active={pathname === "/activity"}
              collapsed={collapsed}
            />
          </ul>
        </nav>

        {/* Footer */}
        <div
          className={cn(
            "border-t border-border p-3",
            collapsed ? "flex flex-col items-center gap-2" : "space-y-2",
          )}
        >
          {!collapsed && (
            <>
              <ThemeToggle stretch />
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-fg-muted" title={userTooltip}>
                  {userName}
                </span>
                <form action="/auth/signout" method="post">
                  <Button type="submit" variant="ghost" size="sm">
                    Salir
                  </Button>
                </form>
              </div>
              <div className="border-t border-border pt-2 text-xs text-fg-subtle">
                <Link
                  href="/about"
                  className={cn(
                    "block rounded-md px-2 py-1 text-center hover:bg-surface-2 hover:text-fg",
                    pathname === "/about" && "bg-accent-soft text-accent",
                  )}
                >
                  Acerca de & feedback
                </Link>
                {/* Versión: uso interno para verificar qué build corre cada
                 * usuario cuando reportan bugs. Render bien discreto —
                 * mono, 10px, color subtle, centrado. */}
                <p
                  className="mt-1 text-center font-mono text-[10px] tracking-tight text-fg-subtle"
                  title={`HitFactor v${appVersion}`}
                >
                  v{appVersion}
                </p>
              </div>
            </>
          )}
          {collapsed && (
            <>
              <Link
                href="/about"
                aria-label="Acerca de"
                title="Acerca de"
                className={cn(
                  "rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg",
                  pathname === "/about" && "bg-accent-soft text-accent",
                )}
              >
                <Info className="h-4 w-4" aria-hidden />
              </Link>
              <form action="/auth/signout" method="post">
                <Button type="submit" variant="ghost" size="sm" aria-label="Salir">
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </form>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function NavItem({
  href,
  icon,
  label,
  count,
  active,
  collapsed,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  count?: number;
  active: boolean;
  collapsed: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        title={collapsed ? label : undefined}
        className={cn(
          "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
          collapsed && "justify-center px-2",
          active
            ? "bg-accent-soft text-accent"
            : "text-fg-muted hover:bg-surface-2 hover:text-fg",
        )}
      >
        <span className="shrink-0">{icon}</span>
        {!collapsed && (
          <>
            <span className="flex-1 truncate">{label}</span>
            {count !== undefined && (
              <span className="shrink-0 font-mono text-xs text-fg-subtle">
                {count}
              </span>
            )}
          </>
        )}
      </Link>
    </li>
  );
}
