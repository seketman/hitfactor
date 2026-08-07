import { Link } from "@/i18n/navigation";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { requireUser } from "@/lib/supabase/require-user";
import { getFirearmById } from "@/lib/db/firearms";
import { absoluteUrl } from "@/lib/seo/site-url";
import { PrintButton } from "./PrintButton";

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Página imprimible con el QR para pegar al estuche / arma. Al escanear,
 * el celular abre el navegador en `/firearms/[id]?log=1#log-form` que
 * expande automáticamente el form de "Registrar sesión".
 *
 * RLS: la página inicial chequea ownership (vía `requireUser` +
 * `getFirearmById`). Si otro user escanea, llega a la app pero el insert
 * del log será rechazado por la RLS de `firearm_usage_log`.
 *
 * URL del QR: estable por `firearm_id`. Si el usuario pierde el adhesivo
 * impreso, vuelve a esta página y vuelve a imprimir — el QR es el mismo.
 */
export default async function FirearmQrPage({ params }: PageProps) {
  const { id } = await params;

  // Si la sesión expiró, mandamos al login con retorno a esta misma página
  // (para que pueda imprimir su QR sin perder el contexto).
  const { supabase } = await requireUser({ returnTo: `/firearms/${id}/qr` });

  const firearm = await getFirearmById(supabase, id);
  if (!firearm) notFound();

  // The URL comes from `NEXT_PUBLIC_SITE_URL` via `absoluteUrl`, the same
  // source of truth the whole SEO surface uses (canonical, sitemap,
  // robots, Open Graph, JSON-LD).
  //
  // It used to be derived from the request's `Host` / `X-Forwarded-Host`
  // headers, which are client input: a tampered header returned a page
  // whose QR pointed somewhere else. That matters more here than in a
  // typical host-header injection, because **this QR gets printed and
  // stuck to a firearm**. You don't revoke a sticker with a deploy —
  // someone has to find it and replace it. See issue #198.
  //
  // Encoding `/q/{qr_code}` (6 chars) rather than the original
  // `/firearms/{uuid}?log=1#log-form` takes the URL from ~85 chars to
  // ~30, which shrinks the QR from 33×33 modules to ~25×25 (≈60% of the
  // area) and lets the sticker be smaller without losing legibility. The
  // `/q/...` route resolves code → id via RPC and redirects to the detail
  // page.
  const targetUrl = absoluteUrl(`/q/${firearm.qr_code}`);

  // QR como SVG inline para que escale bien al imprimir (vs PNG raster).
  // ECC level "M" balancea capacidad vs robustez — un QR con marcas/polvo
  // típico de polígono sigue siendo legible.
  const qrSvg = await QRCode.toString(targetUrl, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 300,
  });

  return (
    <PageContainer className="max-w-2xl">
      <Link
        href={`/firearms/${id}`}
        className="mb-4 inline-block text-sm text-fg-muted hover:text-accent print:hidden"
      >
        ← {firearm.name}
      </Link>

      <Card className="p-8 text-center">
        <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
          QR de registro rápido
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {firearm.name}
        </h1>
        {(firearm.brand || firearm.model || firearm.caliber) && (
          <p className="mt-1 text-sm text-fg-muted">
            {[firearm.brand, firearm.model, firearm.caliber]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}

        <div
          className="mx-auto mt-6 inline-block rounded-lg bg-white p-4"
          // El QR se renderiza como SVG inline. La lib lo genera con colores
          // de alto contraste; lo envolvemos en bg blanco fijo para que se
          // imprima legible aun cuando la app esté en tema oscuro.
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />

        <p className="mx-auto mt-6 max-w-md text-sm text-fg-muted">
          Pegá este código en el estuche o en el arma. Cuando termines una
          sesión de práctica, escanealo con la cámara del celular y vas a
          llegar al form de registro con el arma ya seleccionada.
        </p>

        <p className="mt-3 break-all font-mono text-xs text-fg-subtle">
          {targetUrl}
        </p>

        <div className="mt-6 flex justify-center gap-2 print:hidden">
          <PrintButton />
          <Link href={`/firearms/${id}`}>
            <Button variant="ghost">Volver</Button>
          </Link>
        </div>
      </Card>
    </PageContainer>
  );
}
