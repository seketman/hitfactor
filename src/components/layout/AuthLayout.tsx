import { type ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-between gap-2">
          <Link href="/" className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-accent" aria-hidden />
            <span className="font-semibold tracking-tight">HitFactor</span>
          </Link>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </div>

        <div className="rounded-[10px] border border-border bg-surface p-7">
          <h1 className="mb-1 text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mb-6 text-sm text-fg-muted">{subtitle}</p>}
          {children}
        </div>

        {footer && (
          <p className="mt-6 text-center text-sm text-fg-muted">{footer}</p>
        )}
      </div>
    </main>
  );
}
