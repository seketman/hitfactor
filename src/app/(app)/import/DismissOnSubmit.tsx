"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Oculta a sus hijos en cuanto cualquier form de la página dispara un submit.
 *
 * Caso de uso: el resultado de un import previo (Alert de éxito o error) se
 * renderiza desde URL params en un server component. Mientras el server
 * action del re-intento está corriendo, la URL todavía es la vieja y el
 * Alert se queda visible — confunde al usuario que cree que ese mensaje
 * pertenece a la corrida en curso.
 *
 * Con este wrapper, en cuanto el submit del nuevo intento se dispara
 * (validación HTML5 ya pasó), ocultamos el alert. Cuando el server action
 * termine y la nueva URL llegue, el componente se remonta con el nuevo
 * estado y el alert correspondiente vuelve a aparecer.
 */
export function DismissOnSubmit({ children }: { children: ReactNode }) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const handler = () => setDismissed(true);
    document.addEventListener("submit", handler, true);
    return () => document.removeEventListener("submit", handler, true);
  }, []);

  if (dismissed) return null;
  return <>{children}</>;
}
