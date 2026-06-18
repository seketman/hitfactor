import { Badge } from "@/components/ui/Badge";

/**
 * Celda de "puesto" reutilizable. Dos formas:
 *
 *  - Completa (`showAbsent`, default): DQ → Ausente → place. Usada en el
 *    ranking público y en los summary cards del detalle personal.
 *  - Solo-DQ (`showAbsent={false}`): DQ → place ?? "—". Usada en las tablas
 *    de stages, donde no existe el estado "ausente" por stage.
 *
 * El render de cada caso es idéntico al inline original que reemplaza.
 */
export function PlaceCell({
  isDq,
  isAbsent,
  place,
  showAbsent = true,
}: {
  isDq: boolean;
  isAbsent?: boolean;
  place: number | null;
  showAbsent?: boolean;
}) {
  if (isDq) return <Badge tone="danger">DQ</Badge>;
  if (showAbsent) {
    if (isAbsent) return <Badge tone="default">Ausente</Badge>;
    return <>{place}</>;
  }
  return <>{place ?? "—"}</>;
}
