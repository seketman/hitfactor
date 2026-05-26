"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";

/**
 * Botón "Imprimir" que dispara el diálogo de impresión del navegador.
 * Cliente porque `window.print()` no existe del lado server. Se renderiza
 * solo en la página de QR — el resto del flow es Server Components.
 */
export function PrintButton() {
  return (
    <Button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2"
    >
      <Printer className="h-4 w-4" aria-hidden />
      Imprimir
    </Button>
  );
}
