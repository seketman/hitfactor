import { ChevronDown } from "lucide-react";

/**
 * Heading clicable que actúa de toggle del `<details>` padre. Mantiene la
 * tipografía (uppercase + tracking) de otras secciones para que la pantalla
 * se sienta consistente; el único agregado visual es el chevron que rota
 * 180° cuando el contenedor está abierto.
 *
 * Uso: dentro de un `<details className="group">`, justo arriba del
 * contenido colapsable. La rotación del chevron depende de `group-open`,
 * así que el `group` className del padre es necesario.
 */
export function CollapsibleHeading({ label }: { label: string }) {
  return (
    <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium uppercase tracking-wider text-fg-muted hover:text-fg [&::-webkit-details-marker]:hidden">
      <ChevronDown
        className="h-4 w-4 transition-transform group-open:rotate-180"
        aria-hidden
      />
      {label}
    </summary>
  );
}
