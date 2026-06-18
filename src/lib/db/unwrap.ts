/**
 * Desempaqueta el resultado de una query de Supabase/PostgREST.
 *
 * Si la query trae `error` (RLS denial, timeout, network, select inválido,
 * constraint), **lanza** con contexto en lugar de devolver data vacía en
 * silencio. Sin esto, una falla transitoria de DB es indistinguible de
 * "no hay filas" → la UI muestra 0 matches / dashboard vacío como si fuera
 * el estado real del usuario, sin log ni error. Ver issue #113.
 *
 * Se tipa el `error` de forma estructural (`{ message } | null`) para no
 * acoplar el helper al tipo concreto `PostgrestError` del SDK.
 *
 * Para queries con `{ count }` (paginadas), pasá el resultado completo a
 * `unwrap` para validar el error y leé `result.count` por separado.
 */
export function unwrap<T>(
  result: { data: T; error: { message: string } | null },
  context: string,
): T {
  if (result.error) {
    throw new Error(`[db:${context}] ${result.error.message}`);
  }
  return result.data;
}
