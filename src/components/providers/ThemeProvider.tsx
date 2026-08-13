"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ThemeProviderProps } from "next-themes";
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

/** `next-themes` does not export this one, so it is derived from the props. */
type ThemeScriptProps = NonNullable<ThemeProviderProps["scriptProps"]>;

/**
 * Extra props for the inline script `next-themes` injects, which is what
 * decides the theme before first paint.
 *
 * That script reads the stored preference and puts `.dark` / `.light` on
 * `<html>` synchronously, so the page never flashes the wrong theme.
 * `next-themes` renders it with **no `type` attribute** — that is precisely
 * what makes the browser execute it.
 *
 * The missing `type` is also what makes React log, once per page load:
 *
 * > Encountered a script tag while rendering React component. Scripts inside
 * > React components are never executed when rendering on the client.
 * > Consider using template tag instead.
 *
 * Two things about that check (`react-dom-client.development.js`, the
 * `case "script"` in `createInstance` and its `isScriptDataBlock` guard) make
 * the split below the only lever available:
 *
 *  - it runs **only when React creates the node on the client**. Hydration
 *    takes the other branch and never reaches it.
 *  - it is skipped for any `type` that is not a JavaScript MIME type. That is
 *    why `<script type="application/ld+json">` never warns — React exempts
 *    data blocks on purpose — and why declaring an honest `text/javascript`
 *    here would NOT help: those are exactly the values it warns about.
 *
 * Hence: no `type` on the server, where the script has to run; an inert
 * data-block `type` on the client, where it is only ever reconciled.
 *
 * This leans on one assumption per dependency, so re-check both on a bump:
 *  - **React / Next**: that warning heuristic is a private React DOM internal.
 *    If it ever stops exempting data blocks, this silently stops working —
 *    and no test would notice, because the only symptom is dev-only console
 *    output. See the note in `tests/theme-script.test.ts`.
 *  - **next-themes**: the server/client difference is a deliberate hydration
 *    mismatch. It stays quiet only because `next-themes` hardcodes
 *    `suppressHydrationWarning` on this script.
 *
 * Two shapes here are deliberate. The result is computed **once, at module
 * scope**, because the script sits behind `React.memo` and a fresh object on
 * every render would defeat it. And `isBrowser` is a parameter rather than an
 * inline `typeof window` check so that both branches stay testable without
 * stubbing `window` — the suite runs under `environment: "node"`.
 */
export function themeScriptProps(
  isBrowser: boolean,
): ThemeScriptProps | undefined {
  return isBrowser ? { type: "application/json" } : undefined;
}

const THEME_SCRIPT_PROPS = themeScriptProps(typeof window !== "undefined");

/**
 * `next-themes` wrapper:
 *  - `defaultTheme="system"`: follow the OS/browser preference by default.
 *  - `enableSystem`: enable the "system" mode.
 *  - `attribute="class"`: put the `.dark` / `.light` class on `<html>`.
 *  - `disableTransitionOnChange`: avoid odd global transitions when toggling.
 */
export function ThemeProvider({ children }: Props) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      scriptProps={THEME_SCRIPT_PROPS}
    >
      {children}
    </NextThemesProvider>
  );
}
