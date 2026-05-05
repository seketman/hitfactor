"use client";

import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Mode = "light" | "dark" | "system";

const MODES: { key: Mode; label: string; icon: typeof Sun }[] = [
  { key: "light", label: "Claro", icon: Sun },
  { key: "system", label: "Sistema", icon: Monitor },
  { key: "dark", label: "Oscuro", icon: Moon },
];

/**
 * Toggle de tema con tres opciones: Claro / Sistema / Oscuro.
 * La elección se persiste por next-themes en localStorage.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Evita mismatch entre server (sin tema resuelto) y client.
  useEffect(() => {
    setMounted(true);
  }, []);

  const current: Mode = (mounted ? theme : "system") as Mode;

  return (
    <div
      role="radiogroup"
      aria-label="Modo de color"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5",
        className,
      )}
    >
      {MODES.map(({ key, label, icon: Icon }) => {
        const active = current === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(key)}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded transition-colors",
              active
                ? "bg-surface text-fg shadow-sm"
                : "text-fg-muted hover:text-fg",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
