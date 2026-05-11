import { type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

/**
 * Select estilizado para mantener consistencia con Input: alto de h-10,
 * borde y fondo iguales, y un chevron propio para no depender del look
 * nativo del browser (que cambia entre Chrome/Safari/Firefox).
 */
export function Select({ label, className, children, ...props }: SelectProps) {
  const select = (
    <div className="relative">
      <select
        className={cn(
          "block h-10 w-full appearance-none rounded-md border border-border bg-surface-2 px-3 pr-9 text-sm text-fg",
          "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle"
        aria-hidden
      />
    </div>
  );

  if (!label) return select;

  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      {select}
    </label>
  );
}
