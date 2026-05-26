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
 *
 * Para `type="date"` centramos vertical el valor del input. Chrome y Safari
 * usan pseudo-elementos distintos para renderizar la fecha:
 *  - Chrome: `::-webkit-datetime-edit` (el área editable cuando está focused).
 *  - Safari: `::-webkit-date-and-time-value` (el contenedor del valor
 *    cuando NO está focused) — éste tiene un `line-height` por defecto que
 *    no respeta el alto del input padre y deja el texto flusheado arriba.
 * Tratamos ambos para que el centrado se vea consistente en cualquiera de
 * los dos browsers; en Firefox los selectores no hacen nada y caemos al
 * comportamiento default (que ya centra bien).
 */
export function Input({ label, hint, className, ...props }: InputProps) {
  const input = (
    <input
      className={cn(
        "block h-10 w-full rounded-md border border-border bg-surface-2 px-3 text-sm text-fg",
        "placeholder:text-fg-subtle",
        "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20",
        "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        // Chrome
        "[&::-webkit-datetime-edit]:flex [&::-webkit-datetime-edit]:h-full [&::-webkit-datetime-edit]:items-center [&::-webkit-datetime-edit]:p-0",
        // Safari
        "[&::-webkit-date-and-time-value]:flex [&::-webkit-date-and-time-value]:h-full [&::-webkit-date-and-time-value]:items-center [&::-webkit-date-and-time-value]:m-0 [&::-webkit-date-and-time-value]:text-left",
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
