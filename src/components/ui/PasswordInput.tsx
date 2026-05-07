"use client";

import { useState } from "react";
import type { InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface PasswordInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  hint?: string;
}

/**
 * Input de contraseña con toggle "ojo" para mostrar/ocultar.
 *
 * Arranca oculto por default (type="password"). Mimea el estilo del Input
 * común — la única diferencia visual es el botón a la derecha.
 */
export function PasswordInput({
  label,
  hint,
  className,
  ...props
}: PasswordInputProps) {
  const [show, setShow] = useState(false);

  const inputEl = (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        className={cn(
          "block w-full rounded-md border border-border bg-surface-2 px-3 py-2 pr-10 text-sm text-fg",
          "placeholder:text-fg-subtle",
          "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20",
          className,
        )}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
        title={show ? "Ocultar contraseña" : "Mostrar contraseña"}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-fg-subtle hover:text-fg"
      >
        {show ? (
          <EyeOff className="h-4 w-4" aria-hidden />
        ) : (
          <Eye className="h-4 w-4" aria-hidden />
        )}
      </button>
    </div>
  );

  if (!label) return inputEl;

  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      {inputEl}
      {hint && <span className="mt-1 block text-xs text-fg-subtle">{hint}</span>}
    </label>
  );
}
