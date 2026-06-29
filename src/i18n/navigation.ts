import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * Wrappers de navegación locale-aware. Reemplazan a `next/link` y
 * `next/navigation` en los flujos del MVP: `Link`/`redirect`/`useRouter`
 * prefijan automáticamente el locale activo, así no hay que concatenar
 * `/${locale}` a mano en cada href.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
