import { type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: React.ReactNode;
}

/**
 * Input estilizado. Alto fijo h-10 para alinearse con Select. Para `type="number"`
 * ocultamos los spinners nativos del browser — eran inconsistentes entre Chrome
 * y Safari y rompían la simetría visual al lado de un Select. Se sigue
 * pudiendo tipear el número.
 */
export function Input({ label, hint, className, ...props }: InputProps) {
  const input = (
    <input
      className={cn(
        "block h-10 w-full rounded-md border border-border bg-surface-2 px-3 text-sm text-fg",
        "placeholder:text-fg-subtle",
        "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20",
        "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        className,
      )}
      {...props}
    />
  );

  if (!label) return input;

  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      {input}
      {hint && <span className="mt-1 block text-xs text-fg-subtle">{hint}</span>}
    </label>
  );
}
