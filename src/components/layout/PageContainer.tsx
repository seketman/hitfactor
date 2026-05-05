import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function PageContainer({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mx-auto w-full max-w-6xl px-6 py-8", className)}
      {...props}
    />
  );
}
