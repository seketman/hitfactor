"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/require-user";
import { updateUiPrefs } from "@/lib/db/profiles";

/**
 * Tamaños permitidos del selector. Tiene que matchear la constante del
 * page.tsx — si querés agregar opciones, cambialo en los dos lados.
 * Mantenerlas separadas evita que el page (client) importe de un archivo
 * marcado `"use server"`, lo cual rompería el bundle.
 */
const ALLOWED_SIZES = [10, 20, 50, 100];

/**
 * Persiste el tamaño de página elegido por el usuario para `/matches`.
 * Se llama desde el `<Pagination>` cuando el usuario cambia el selector,
 * así la preferencia lo sigue entre dispositivos/sesiones (la otra opción
 * era localStorage, pero eso lo ata al browser).
 *
 * Tolerante a inputs inválidos: si el `size` no está en la whitelist,
 * no escribe nada (early return). No queremos abortar el flujo del
 * usuario por un click roto, y la UI cae al default igual.
 */
export async function saveMatchesPageSize(size: number): Promise<void> {
  if (!Number.isFinite(size) || !ALLOWED_SIZES.includes(size)) return;
  const { supabase } = await requireUser();
  await updateUiPrefs(supabase, { matchesPageSize: size });
}

/**
 * Oculta para siempre las sugerencias de "Soy yo" en `/matches`. Pensada
 * para usuarios que vieron la card pero ninguno de los candidatos es
 * realmente ellos (o que ya entendieron el flujo y quieren la vista limpia).
 *
 * No es destructiva: si el usuario claima cualquier shooter más adelante,
 * las sugerencias se ocultan igual por el gate primario (`myShooters > 0`),
 * así que este flag solo importa mientras el usuario tiene 0 claims.
 */
export async function dismissClaimSuggestions(): Promise<void> {
  const { supabase } = await requireUser();
  await updateUiPrefs(supabase, { claimSuggestionsDismissed: true });
  revalidatePath("/matches");
}
