import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "info" | "success" | "danger" | "warning";

interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  tone?: Tone;
  title?: string;
  children: ReactNode;
}

const toneClasses: Record<Tone, string> = {
  info: "border-info/30 bg-info/10 text-info",
  success: "border-success/30 bg-success/10 text-success",
  danger: "border-danger/40 bg-danger/10 text-danger",
  warning: "border-accent/30 bg-accent-soft text-accent",
};

export function Alert({ tone = "info", title, className, children, ...props }: AlertProps) {
  return (
    <div
      className={cn(
        "rounded-md border px-4 py-3 text-sm",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {title && <p className="font-medium">{title}</p>}
      <div className={title ? "mt-1 text-fg-muted" : "text-fg-muted"}>{children}</div>
    </div>
  );
}
