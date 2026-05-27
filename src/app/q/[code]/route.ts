import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Endpoint de deep-link del QR pegado al arma. Resuelve el código corto
 * (6 chars) a un firearm_id vía RPC y redirige al detalle con el form
 * de registro de sesión auto-expandido.
 *
 * Diseño:
 *  - El handler corre AL MARGEN del grupo (app), así que no carga la
 *    sidebar shell ni nada de chrome — es puro redirect.
 *  - El RPC `resolve_firearm_qr_code` es SECURITY DEFINER y está GRANTed
 *    a anon/authenticated. Eso permite que un usuario deslogueado escanee
 *    el QR: el resolver le da el id y al llegar a `/firearms/{id}`, el
 *    `requireUser` lo manda a /login preservando el destino. Una vez
 *    logueado, RLS hace el check de ownership: si no es el dueño, ve
 *    notFound.
 *  - Si el código no existe (typo, sticker roto, arma borrada), caemos
 *    a /firearms — pantalla por defecto del catálogo del usuario.
 *
 * NOTA: el route handler no necesita `dynamic = "force-dynamic"` porque
 * Next ya trata las rutas con params dinámicos como dynamic por default.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;

  // Normalizamos a mayúsculas (el alfabeto del generador es 100% upper)
  // por si el QR scanner reportó algo en minúsculas — el sticker físico
  // siempre es upper pero el handler debería ser case-insensitive.
  const normalized = code.toUpperCase();

  const supabase = await createClient();
  const { data: firearmId } = await supabase.rpc("resolve_firearm_qr_code", {
    p_code: normalized,
  });

  // `data` viene como string (el uuid) cuando matchea, o null si no.
  const target =
    typeof firearmId === "string" && firearmId.length > 0
      ? `/firearms/${firearmId}?log=1#log-form`
      : "/firearms";

  return NextResponse.redirect(new URL(target, request.url));
}
