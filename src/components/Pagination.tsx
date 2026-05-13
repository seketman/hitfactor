"use client";

import { useId } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaginationProps {
  /** Página actual (1-based). */
  page: number;
  /** Total de páginas calculado por el caller a partir de `total/size`. */
  totalPages: number;
  /** Total de items (para mostrar "N torneos"). */
  total: number;
  /** Items por página actuales. */
  size: number;
  /** Opciones del selector de tamaño. */
  sizes: ReadonlyArray<number>;
  /** Ruta base de la página, ej `/matches`. */
  basePath: string;
  /** Etiqueta singular/plural del recurso paginado. */
  itemLabel: { one: string; many: string };
  /**
   * Server Action opcional que persiste el `size` elegido en el perfil
   * del usuario. Si está, se dispara cuando el usuario cambia el selector,
   * así la preferencia lo sigue entre dispositivos. La nav igual usa el
   * `?size` de la URL — esto solo cambia el default de la próxima visita.
   */
  onSizeChange?: (size: number) => Promise<void>;
}

/**
 * Paginación reutilizable: selector de tamaño + Prev/Next + números.
 *
 * - Los links son `<Link>` reales (`basePath?page=N&size=M`) para que sirvan
 *   sin JS y para que el browser conserve scroll/back/forward.
 * - El selector de tamaño es la única parte que necesita JS — vuelve a la
 *   página 1 al cambiar (es lo que el usuario espera; quedarse en la 5 de
 *   un layout viejo desorienta).
 * - Si totalPages === 1 ocultamos los controles de navegación, pero
 *   mantenemos el selector + caption porque sirven aunque haya 1 sola
 *   página (te dice cuántos hay y te deja achicar/agrandar).
 */
export function Pagination({
  page,
  totalPages,
  total,
  size,
  sizes,
  basePath,
  itemLabel,
  onSizeChange,
}: PaginationProps) {
  const router = useRouter();
  const selectId = useId();

  const buildHref = (p: number) => `${basePath}?page=${p}&size=${size}`;

  const handleSizeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSize = Number(e.target.value);
    // Disparamos la persistencia "fire-and-forget" — no esperamos a la DB
    // para navegar porque eso ataría la latencia del usuario al round-trip,
    // y la UI ya muestra el nuevo size apenas la nav del client side resuelve.
    // Si el save falla, la sesión actual sigue usando el size elegido (vive
    // en la URL); recién se notaría en la próxima visita sin `?size`.
    if (onSizeChange) {
      void onSizeChange(newSize);
    }
    router.push(`${basePath}?page=1&size=${newSize}`);
  };

  const itemWord = total === 1 ? itemLabel.one : itemLabel.many;

  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-4 text-sm">
      <div className="flex items-center gap-2 text-fg-muted">
        <label htmlFor={selectId} className="text-xs uppercase tracking-wider">
          Por página
        </label>
        <select
          id={selectId}
          value={size}
          onChange={handleSizeChange}
          className="h-8 rounded-md border border-border bg-surface-2 px-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        >
          {sizes.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="ml-2">
          {totalPages > 1 ? (
            <>
              Página <span className="text-fg">{page}</span> de{" "}
              <span className="text-fg">{totalPages}</span>{" "}
              <span className="text-fg-subtle">
                ({total} {itemWord})
              </span>
            </>
          ) : (
            <>
              {total} {itemWord}
            </>
          )}
        </span>
      </div>

      {totalPages > 1 && (
        <nav className="flex items-center gap-1" aria-label="Paginación">
          <PageLink
            href={buildHref(page - 1)}
            disabled={page <= 1}
            label="Anterior"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Anterior</span>
          </PageLink>

          {getPageItems(page, totalPages).map((item, i) =>
            item === "ellipsis" ? (
              <span
                key={`e-${i}`}
                className="px-2 text-fg-subtle"
                aria-hidden
              >
                …
              </span>
            ) : (
              <PageNumber
                key={item}
                href={buildHref(item)}
                n={item}
                active={item === page}
              />
            ),
          )}

          <PageLink
            href={buildHref(page + 1)}
            disabled={page >= totalPages}
            label="Siguiente"
          >
            <span className="hidden sm:inline">Siguiente</span>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </PageLink>
        </nav>
      )}
    </div>
  );
}

/**
 * Botones Prev/Next. Cuando están disabled renderizamos un `<span>` en lugar
 * de `<Link>` porque un Link con `aria-disabled` igual navega — y queremos
 * que un click en "Anterior" desde la página 1 sea no-op.
 */
function PageLink({
  href,
  disabled,
  label,
  children,
}: {
  href: string;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  const cls = cn(
    "inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors",
    disabled
      ? "border-border bg-surface-2 text-fg-subtle"
      : "border-border bg-surface-2 text-fg-muted hover:border-border-strong hover:text-fg",
  );
  if (disabled) {
    return (
      <span className={cls} aria-disabled aria-label={label}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={cls} aria-label={label}>
      {children}
    </Link>
  );
}

function PageNumber({
  href,
  n,
  active,
}: {
  href: string;
  n: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs font-medium transition-colors",
        active
          ? "border-accent bg-accent text-bg"
          : "border-border bg-surface-2 text-fg-muted hover:border-border-strong hover:text-fg",
      )}
    >
      {n}
    </Link>
  );
}

/**
 * Decide qué números mostrar. Para totalPages chico (≤7) mostramos todos;
 * para más, mostramos primera, última, current ± 1, y elipsis en los
 * huecos. Ej (page=5, total=10): 1 … 4 5 6 … 10.
 */
function getPageItems(
  page: number,
  totalPages: number,
): Array<number | "ellipsis"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const items: Array<number | "ellipsis"> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) items.push("ellipsis");
  for (let i = start; i <= end; i++) items.push(i);
  if (end < totalPages - 1) items.push("ellipsis");
  items.push(totalPages);
  return items;
}
