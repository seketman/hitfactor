/**
 * Renderea un bloque `<script type="application/ld+json">` con datos
 * estructurados (schema.org).
 *
 * Seguridad: sólo se debe pasar `data` definida en código — nunca input del
 * usuario. Igual escapamos `<` a `<` para que un valor no pueda cerrar el
 * `<script>` ni inyectar markup.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
