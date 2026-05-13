import type { Club } from "./db/types";

/**
 * Helpers para interpretar `matches.region` y traducirlo a nombre de club.
 *
 * Diseño: la fuente de verdad de nombres es la tabla `clubs` (DB). Estos
 * helpers son puros — el caller fetchea `listClubs()` y pasa el resultado
 * como `ClubLookup`. Antes había un diccionario hardcoded acá, pero quedaba
 * desincronizado de la DB cada vez que sumábamos clubes federados.
 */

const COUNTRY_CODES = new Set(["ARG"]);

export interface ParsedRegion {
  /** El código tal como vino, normalizado (ej "ARG-TFALP"). */
  raw: string | null;
  /** Código de país detectado, ej "ARG". */
  country: string | null;
  /** Código del club detectado, ej "TFALP". */
  clubCode: string | null;
}

/**
 * Parsea un campo `region` de PractiScore.
 *
 * Acepta cualquiera de estos formatos:
 *  - `ARG-TFALP` → country=ARG, clubCode=TFALP
 *  - `TFALP-ARG` → country=ARG, clubCode=TFALP
 *  - `TFALP`     → country=null, clubCode=TFALP
 *  - vacío/null  → todos null
 */
export function parseRegion(region: string | null | undefined): ParsedRegion {
  if (!region) {
    return { raw: null, country: null, clubCode: null };
  }

  const parts = region.split("-").map((s) => s.trim()).filter(Boolean);

  if (parts.length === 0) {
    return { raw: region, country: null, clubCode: null };
  }

  if (parts.length === 1) {
    const code = parts[0];
    const isCountry = COUNTRY_CODES.has(code);
    return {
      raw: region,
      country: isCountry ? code : null,
      clubCode: isCountry ? null : code,
    };
  }

  // 2+ partes: la que sea código de país es el country, la otra es el club.
  const country = parts.find((p) => COUNTRY_CODES.has(p)) ?? null;
  const clubCode = parts.find((p) => !COUNTRY_CODES.has(p)) ?? null;

  return { raw: region, country, clubCode };
}

/** Helper directo para mostrar el código del club. */
export function getClubCode(region: string | null | undefined): string | null {
  return parseRegion(region).clubCode;
}

/** Mapa `code → name` para resolver nombres de club sin reconsultar la DB. */
export type ClubLookup = ReadonlyMap<string, string>;

/** Construye un `ClubLookup` desde el resultado de `listClubs()`. */
export function buildClubLookup(
  clubs: ReadonlyArray<Pick<Club, "code" | "name">>,
): ClubLookup {
  return new Map(clubs.map((c) => [c.code, c.name]));
}

/**
 * Devuelve el nombre completo del club a partir del `region`, usando el
 * catálogo provisto. Si el code no está en el catálogo (ej. región custom,
 * club extranjero), cae al code crudo — coherente con cómo se mostraban
 * antes los clubes desconocidos en la UI.
 */
export function getClubName(
  region: string | null | undefined,
  clubs: ClubLookup,
): string | null {
  const code = getClubCode(region);
  if (!code) return null;
  return clubs.get(code) ?? code;
}
