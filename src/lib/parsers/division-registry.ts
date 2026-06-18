import { DISCIPLINE, type DisciplineCode } from "../disciplines";

/**
 * Fuente única del mapeo nombre-de-división → `divisions.code`, por disciplina.
 *
 * Antes cada parser (practiscore, winmss-pdf, practiscore-pdf, fat-pdf,
 * steel-challenge-pdf) tenía su propia copia de este mapa, y ya habían
 * divergido: solo uno conocía "Classic Manual" (CM), solo otro conocía
 * "PCC Iron"/"OPTICS", etc. Una división agregada en un formato fallaba en
 * silencio en los demás. Este registry es la unión de todos los alias
 * conocidos — los parsers lo consumen vía `resolveDivisionCode` (issue #114).
 *
 * Las claves se guardan normalizadas (MAYÚSCULAS, sin tildes, espacios
 * colapsados), tal como las devuelve `normalizeDivisionName`. No hay
 * conflictos: cada alias mapea a un único code por disciplina.
 */
const DIVISION_CODE_BY_DISCIPLINE: Record<
  DisciplineCode,
  Record<string, string>
> = {
  [DISCIPLINE.IPSC]: {
    OPEN: "O",
    "SG OPEN": "O",
    PRODUCTION: "P",
    "PRODUCTION OPTICS": "PO",
    STANDARD: "S",
    "SG STANDARD": "S",
    "STANDARD MANUAL": "SM",
    "SG STANDARD MANUAL": "SM",
    "CARRY OPTICS": "CO",
    // ESS llama "OPTICS" a Carry Optics.
    OPTICS: "CO",
    REVOLVER: "R",
    CLASSIC: "CL",
    "SG CLASSIC": "CL",
    // Escopeta (PractiScore): división propia, distinta de Classic. Ver
    // migración 0017.
    "CLASSIC MANUAL": "CM",
    MODIFIED: "MS",
    "MODIFIED SHOTGUN": "MS",
    PCC: "PCC",
    // Variantes sin óptica (iron sights) de distintos generadores.
    "PCC IRON": "PCC",
    "PC IRON": "PCC",
    "PISTOL CALIBER CARBINE": "PCC",
    // Variantes con óptica.
    "PCC OPTIC": "PCCO",
    "PCC OPTICS": "PCCO",
    "PC OPTICS": "PCCO",
    "PISTOL CALIBER CARBINE OPTICS": "PCCO",
    PISTOLA: "PIS",
  },
  [DISCIPLINE.FBI]: {
    PISTOLA: "PIS",
    REVOLVER: "REV",
    MINIRIFLE: "MINI",
    PCC: "PCC",
  },
  [DISCIPLINE.STEEL]: {
    PISTOLA: "PISTOLA",
    REVOLVER: "REVOLVER",
    OPEN: "OPEN",
    ROOKIE: "ROOKIE",
    IRON: "IRON",
    OPTIC: "OPTIC",
    PCC: "PCC",
  },
  [DISCIPLINE.COMBAT]: {},
};

/**
 * Normaliza un nombre de división para el lookup: saca tildes, pasa a
 * MAYÚSCULAS, colapsa espacios repetidos y trimea. Es la normalización
 * más permisiva de todos los parsers (superset) — solo hace matchear MÁS,
 * nunca menos.
 */
export function normalizeDivisionName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resuelve el `divisions.code` de un nombre de división para una disciplina.
 * Devuelve `null` si no se reconoce (el caller decide ignorar la sección).
 *
 * Prueba el nombre normalizado y también su variante sin espacios — algunos
 * PDFs parten una palabra ("PISTOLA" → "P ISTOLA") por kerning y la
 * reconstrucción posicional las junta con un espacio.
 */
export function resolveDivisionCode(
  discipline: DisciplineCode,
  raw: string,
): string | null {
  const norm = normalizeDivisionName(raw);
  const map = DIVISION_CODE_BY_DISCIPLINE[discipline];
  return map[norm] ?? map[norm.replace(/\s+/g, "")] ?? null;
}
