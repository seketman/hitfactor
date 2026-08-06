"use client";

import { useRouter } from "@/i18n/navigation";

/**
 * Link de "Volver" estilo back del navegador: si hay historial dentro de la
 * misma sesión, hace `router.back()` (= browser back), respetando la cadena
 * de páginas visitadas. Si la página se abrió directo (tab nueva, link
 * compartido) y no hay historial al cual volver, navega al `fallbackHref`.
 *
 * Por qué no usar un `<Link href={fallbackHref}>` simple:
 *   - Volver a un destino fijo pierde el contexto multi-hop. Ej: dashboard →
 *     match-me → "Ver ranking público" → ranking. El back del ranking
 *     debería ir a match-me (no a /matches), y a su vez el back de match-me
 *     debería ir al dashboard original (no a un fallback).
 *   - Encadenar `?from=` en cada link mantenía contexto pero solo un nivel,
 *     y ensucia las URLs. El back del browser ya tiene la pila correcta.
 *
 * Por qué no usar `<a href="javascript:history.back()">`:
 *   - Lo bloquea el CSP. `router.back()` es la API de Next equivalente.
 *
 * Heurística de "¿hay historial?":
 *   `window.history.length > 1`. Imperfecta (no distingue same-origin de
 *   external) pero la combinamos con un fallback href para que el botón
 *   nunca termine en una página vacía: si terminás en otro origin el back
 *   te lleva ahí, pero solo si la propia sesión del browser ya tuvo otra
 *   navegación. En caso de visita directa pura (length === 1) usamos el
 *   fallback como un Link común.
 */
export function BackLink({
  fallbackHref,
  label = "Volver",
}: {
  fallbackHref: string;
  /** Texto del link. Default "Volver" — generic on purpose. */
  label?: string;
}) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) {
          router.back();
        } else {
          router.push(fallbackHref);
        }
      }}
      className="mb-4 inline-block cursor-pointer bg-transparent p-0 text-sm text-fg-muted hover:text-accent"
    >
      ← {label}
    </button>
  );
}
