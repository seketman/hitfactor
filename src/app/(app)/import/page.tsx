import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { importHtml } from "./actions";

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    ok?: string;
    name?: string;
    entries?: string;
    stages?: string;
    stageResults?: string;
    existed?: string;
  }>;
}) {
  const params = await searchParams;

  return (
    <PageContainer className="max-w-2xl">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Importar resultados</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Subí un archivo HTML exportado de PractiScore. Empezá por el archivo de
          Match Results y después agregá los stages uno por uno.
        </p>
      </header>

      {params.error && (
        <Alert tone="danger" title="No se pudo importar" className="mb-6">
          {params.error}
        </Alert>
      )}

      {params.ok === "1" && (
        <Alert tone="success" title={`Importado: ${params.name}`} className="mb-6">
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {params.entries && Number(params.entries) > 0 && (
              <li>{params.entries} resultados de tiradores</li>
            )}
            {params.stages && Number(params.stages) > 0 && (
              <li>{params.stages} stage(s) nuevos</li>
            )}
            {params.stageResults && Number(params.stageResults) > 0 && (
              <li>{params.stageResults} resultados de stages</li>
            )}
            {params.existed === "1" && (
              <li>El match ya existía — solo se agregaron stages.</li>
            )}
          </ul>
        </Alert>
      )}

      <Card className="p-6">
        <form action={importHtml}>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-fg-muted">
              Archivo HTML
            </span>
            <input
              type="file"
              name="file"
              accept=".html,.htm"
              required
              className="block w-full cursor-pointer rounded-md border border-border bg-surface-2 text-sm text-fg file:mr-4 file:border-0 file:bg-accent file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-bg hover:file:bg-accent-strong"
            />
          </label>
          <Button type="submit" className="mt-6 w-full">
            Importar
          </Button>
        </form>
      </Card>

      <details className="mt-6 text-sm text-fg-muted">
        <summary className="cursor-pointer hover:text-fg">
          ¿Qué archivos puedo subir?
        </summary>
        <div className="mt-3 space-y-2 pl-4">
          <p>
            <strong className="text-fg">Match Results — Combined</strong>: ranking
            general de todas las divisiones en un único archivo.
          </p>
          <p>
            <strong className="text-fg">Match Results — por división</strong>:
            ranking del torneo, separado en bloques por división.
          </p>
          <p>
            <strong className="text-fg">Stage Results</strong>: resultados de un
            stage individual. Subilos después de haber importado el match overall.
          </p>
        </div>
      </details>
    </PageContainer>
  );
}
