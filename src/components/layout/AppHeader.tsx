import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

interface AppHeaderProps {
  userName: string;
}

export function AppHeader({ userName }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-6">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-accent" aria-hidden />
          <span className="font-semibold tracking-tight">HitFactor</span>
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          <Link
            href="/dashboard"
            className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            Dashboard
          </Link>
          <Link
            href="/import"
            className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            Importar
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          <span className="hidden text-sm text-fg-muted sm:inline">{userName}</span>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="ghost" size="sm">
              Salir
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
