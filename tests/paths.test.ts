import { describe, expect, it } from "vitest";
import { isInternalAppPath, safeBackPath } from "@/lib/paths";

/**
 * `isInternalAppPath` es la protección contra **open redirects**: decide si un
 * `from`/`next` que llega del form o del querystring es un destino aceptable.
 * Un usuario controla esos valores, así que un agujero acá manda gente a un
 * dominio ajeno con la apariencia de un flujo propio.
 *
 * No tenía tests. Se agregan junto con la migración a navegación locale-aware
 * (#150), que es el cambio que empezó a apoyarse en esta función para armar
 * los redirects.
 */

describe("isInternalAppPath — rechaza destinos externos", () => {
  const externos = [
    "https://evil.example/phish",
    "http://evil.example",
    "//evil.example", // protocol-relative: el browser lo trata como absoluto
    "///evil.example",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
  ];
  it.each(externos)("rechaza %s", (value) => {
    expect(isInternalAppPath(value)).toBe(false);
  });
});

describe("isInternalAppPath — rechaza lo que no es una ruta", () => {
  it("rechaza vacío, null y undefined", () => {
    expect(isInternalAppPath("")).toBe(false);
    expect(isInternalAppPath(null)).toBe(false);
    expect(isInternalAppPath(undefined)).toBe(false);
  });

  it("rechaza rutas relativas sin barra inicial", () => {
    expect(isInternalAppPath("matches")).toBe(false);
    expect(isInternalAppPath("../matches")).toBe(false);
  });

  // El contrato dice que el query y el fragment son responsabilidad del
  // caller. Si se aceptaran acá, un `?next=` anidado abriría la puerta a
  // encadenar destinos.
  it("rechaza query strings y fragments", () => {
    expect(isInternalAppPath("/matches?foo=1")).toBe(false);
    expect(isInternalAppPath("/matches#top")).toBe(false);
  });

  it("rechaza rutas que no están en la whitelist", () => {
    expect(isInternalAppPath("/admin")).toBe(false);
    expect(isInternalAppPath("/import")).toBe(false);
    expect(isInternalAppPath("/")).toBe(false);
  });
});

describe("isInternalAppPath — acepta las rutas de la app", () => {
  const internas = [
    "/matches",
    "/matches/8f2b1c4e-0000-4000-8000-000000000001",
    "/matches/8f2b1c4e-0000-4000-8000-000000000001/me",
    "/dashboard",
    "/dashboard/ipsc",
    "/dashboard/tiro_fbi",
    "/firearms",
    "/firearms/8f2b1c4e-0000-4000-8000-000000000001",
    "/firearms/8f2b1c4e-0000-4000-8000-000000000001/qr",
    "/ammo",
    "/ammo/8f2b1c4e-0000-4000-8000-000000000001",
    "/activity",
    "/about",
  ];
  it.each(internas)("acepta %s", (value) => {
    expect(isInternalAppPath(value)).toBe(true);
  });
});

/**
 * Las rutas de la whitelist van **sin prefijo de locale**: los wrappers de
 * `@/i18n/navigation` reciben el path lógico y agregan el prefijo ellos. Si
 * alguien empieza a pasar `/es/matches`, esta función lo rechaza y el usuario
 * cae al fallback. Falla seguro, pero conviene tenerlo fijado para que el
 * síntoma sea reconocible.
 */
describe("isInternalAppPath — el prefijo de locale no llega hasta acá", () => {
  it("rechaza rutas ya prefijadas", () => {
    expect(isInternalAppPath("/es/matches")).toBe(false);
    expect(isInternalAppPath("/en/dashboard")).toBe(false);
  });
});

describe("safeBackPath", () => {
  it("devuelve el path si es interno", () => {
    expect(safeBackPath("/matches", "/dashboard")).toBe("/matches");
  });

  it("cae al fallback si el path es externo", () => {
    expect(safeBackPath("https://evil.example", "/dashboard")).toBe(
      "/dashboard",
    );
  });

  it("cae al fallback si no vino nada", () => {
    expect(safeBackPath(undefined, "/dashboard")).toBe("/dashboard");
    expect(safeBackPath(null, "/dashboard")).toBe("/dashboard");
    expect(safeBackPath("", "/dashboard")).toBe("/dashboard");
  });
});
