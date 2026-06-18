import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import type { MyMatchSummary } from "@/lib/db/types";

type StageResult = MyMatchSummary["stageResults"][number];

/**
 * Descriptor de columna para la tabla de stages. Cada disciplina define su
 * propia lista; el shell (Card > Table > THead/TBody, el `stageResults.map`,
 * las keys) es común. `header`/`cell` reciben el className alineado vía
 * `className`, de modo que el render es idéntico al inline original de cada
 * tabla por disciplina.
 */
export interface StageColumn {
  /** Contenido del <TH>. */
  header: ReactNode;
  /** className aplicado al <TH>. */
  headerClassName?: string;
  /** Render de la celda <TD> para una fila. */
  cell: (r: StageResult) => ReactNode;
  /** className aplicado al <TD>. */
  cellClassName?: string;
}

export function StageResultsTable({
  stageResults,
  columns,
}: {
  stageResults: MyMatchSummary["stageResults"];
  columns: StageColumn[];
}) {
  return (
    <Card className="overflow-hidden">
      <Table>
        <THead>
          <TR>
            {columns.map((col, i) => (
              <TH key={i} className={col.headerClassName}>
                {col.header}
              </TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {stageResults.map((r) => (
            <TR key={r.id}>
              {columns.map((col, i) => (
                <TD key={i} className={col.cellClassName}>
                  {col.cell(r)}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}
