/**
 * Mapping de códigos de club (PractiScore region) a nombre completo.
 * Los reportes vienen como `ARG-TFALP` o `TFALP-ARG`. parseRegion() detecta
 * el código del club independientemente del orden.
 */
const CLUB_NAMES: Record<string, string> = {
  TFALP: "Tiro Federal Argentino de La Plata",
  TFLZ: "Tiro Federal de Lomas de Zamora",
  TFABA: "Tiro Federal Argentino Buenos Aires",
  TFBA: "Tiro Federal Buenos Aires",
  ATyGQ: "Asociación Tiradores y Gimnasia Quilmes",
};

const COUNTRY_CODES = new Set(["ARG"]);

export interface ParsedRegion {
  /** El código tal como vino, normalizado (ej "ARG-TFALP"). */
  raw: string | null;
  /** Código de país detectado, ej "ARG". */
  country: string | null;
  /** Código del club detectado, ej "TFALP". */
  clubCode: string | null;
  /** Nombre completo del club si está mapeado, sino el código. */
  clubName: string | null;
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
    return { raw: null, country: null, clubCode: null, clubName: null };
  }

  const parts = region.split("-").map((s) => s.trim()).filter(Boolean);

  if (parts.length === 0) {
    return { raw: region, country: null, clubCode: null, clubName: null };
  }

  if (parts.length === 1) {
    const code = parts[0];
    return {
      raw: region,
      country: COUNTRY_CODES.has(code) ? code : null,
      clubCode: COUNTRY_CODES.has(code) ? null : code,
      clubName: CLUB_NAMES[code] ?? (COUNTRY_CODES.has(code) ? null : code),
    };
  }

  // 2+ partes: la que sea código de país es el country, la otra es el club.
  const countryPart = parts.find((p) => COUNTRY_CODES.has(p)) ?? null;
  const clubPart = parts.find((p) => !COUNTRY_CODES.has(p)) ?? null;

  return {
    raw: region,
    country: countryPart,
    clubCode: clubPart,
    clubName: clubPart ? CLUB_NAMES[clubPart] ?? clubPart : null,
  };
}

/** Helper directo para mostrar el nombre del club. */
export function getClubName(region: string | null | undefined): string | null {
  return parseRegion(region).clubName;
}

/** Helper directo para mostrar el código del club. */
export function getClubCode(region: string | null | undefined): string | null {
  return parseRegion(region).clubCode;
}
