import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * Wrappers de navegación locale-aware. Reemplazan a `next/link` y
 * `next/navigation` en los flujos del MVP: `Link`/`redirect`/`useRouter`
 * prefijan automáticamente el locale activo, así no hay que concatenar
 * `/${locale}` a mano en cada href.
 */
const navigation = createNavigation(routing);

export const { Link, usePathname, useRouter, getPathname } = navigation;

/**
 * `redirect` va aparte, y con anotación de tipo explícita, por una regla de
 * TypeScript que no es obvia: el estrechamiento de flujo por retorno `never`
 * —lo que hace que el código después de un `redirect()` se considere
 * inalcanzable— **solo se aplica si el destino de la llamada está declarado
 * con un tipo explícito**. Un `const` que sale de un destructuring tiene tipo
 * inferido, así que no califica.
 *
 * Sin esto, `redirect()` deja de actuar como `never` en los call-sites: una
 * función que redirige y no devuelve nada más falla con "a function returning
 * 'never' cannot have a reachable end point", y los narrowings posteriores
 * (`if (!user) redirect(...)` seguido de usar `user`) dejan de funcionar.
 */
export const redirect: typeof navigation.redirect = navigation.redirect;
