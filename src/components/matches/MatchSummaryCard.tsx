import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { PlaceCell } from "@/components/matches/PlaceCell";

/**
 * Shell común de los summary cards del detalle personal (IPSC / Steel / FBI).
 * Las tres variantes comparten el mismo `Card` + grid; cada disciplina pasa
 * sus `<Stat>` como children. Render idéntico al inline original.
 */
export function MatchSummaryCard({ children }: { children: ReactNode }) {
  return (
    <Card className="mb-8">
      <div className="grid grid-cols-2 gap-6 p-5 sm:grid-cols-5">{children}</div>
    </Card>
  );
}

/**
 * Stat reutilizable de los summary cards. Movido verbatim desde me/page.tsx.
 */
export function Stat({
  label,
  children,
  mono,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-fg-subtle">{label}</p>
      <p className={`mt-1 text-base font-medium${mono ? " font-mono" : ""}`}>
        {children}
      </p>
    </div>
  );
}

/**
 * Bloque `<Stat label="Puesto">` compartido por las 3 variantes de summary
 * card: DQ → Ausente → place vía PlaceCell. Render idéntico al inline.
 */
export function PlacementStat({
  isDq,
  isAbsent,
  place,
}: {
  isDq: boolean;
  isAbsent: boolean;
  place: number;
}) {
  return (
    <Stat label="Puesto">
      <PlaceCell isDq={isDq} isAbsent={isAbsent} place={place} />
    </Stat>
  );
}
