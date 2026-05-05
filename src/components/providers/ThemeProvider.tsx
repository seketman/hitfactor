"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

/**
 * Wrapper de `next-themes`:
 *  - `defaultTheme="system"`: por default se usa la preferencia del SO/browser.
 *  - `enableSystem`: habilita el modo "system".
 *  - `attribute="class"`: aplica la clase `.dark` o `.light` al <html>.
 *  - `disableTransitionOnChange`: evita transiciones globales raras al togglear.
 */
export function ThemeProvider({ children }: Props) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
