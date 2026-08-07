import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contrato de `redirectWithError`.
 *
 * Se mockea el wrapper de navegación porque el real depende del runtime de
 * Next. Lo que se verifica no es que Next redirija —eso es de Next— sino la
 * **forma del argumento** que se le pasa: que el path vaya como `pathname`,
 * el mensaje como query `error`, y el locale por separado.
 *
 * Vale la pena fijarlo porque la firma tiene dos `string` consecutivos
 * (`path`, `message`) y el compilador no distingue uno de otro: invertirlos
 * compila sin chistar y produce un redirect a la ruta "No se pudo guardar".
 */
const redirectMock = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

const { redirectWithError } = await import("@/lib/redirects");

beforeEach(() => {
  redirectMock.mockClear();
});

describe("redirectWithError", () => {
  it("manda el path como pathname y el mensaje como query `error`", () => {
    redirectWithError("/firearms", "Falta el nombre", "es");

    expect(redirectMock).toHaveBeenCalledWith({
      href: { pathname: "/firearms", query: { error: "Falta el nombre" } },
      locale: "es",
    });
  });

  it("propaga el locale que recibe, no uno fijo", () => {
    redirectWithError("/ammo", "Boom", "en");
    expect(redirectMock.mock.calls[0]![0]).toMatchObject({ locale: "en" });
  });

  // El mensaje va como valor de query, no concatenado a mano en la URL: el
  // encoding lo hace next-intl. Si alguien vuelve al `?error=${...}` de antes,
  // este assert lo marca.
  it("no arma la query string a mano", () => {
    redirectWithError("/import", "Falló: a=1 & b=2 #x", "es");

    const arg = redirectMock.mock.calls[0]![0] as {
      href: { pathname: string; query: Record<string, string> };
    };
    expect(arg.href.pathname).toBe("/import");
    expect(arg.href.query.error).toBe("Falló: a=1 & b=2 #x");
  });

  it("acepta paths dinámicos sin romper la forma", () => {
    redirectWithError("/matches/abc-123", "No se pudo borrar", "es");
    expect(redirectMock.mock.calls[0]![0]).toMatchObject({
      href: { pathname: "/matches/abc-123" },
    });
  });
});
