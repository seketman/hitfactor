/**
 * Estima la cantidad de tiros que disparó un tirador en un match dado,
 * según la disciplina y los datos disponibles.
 *
 * El usuario siempre puede sobreescribir manualmente — esto es solo el
 * pre-fill de la UI.
 *
 *  - Tiro FBI: 8 tiradas × 5 tiros + 5 de warmup = **45**.
 *    Es determinístico, no depende de stages cargados.
 *  - Steel Challenge: 5 strings × 5 platos por stage = ~25 tiros / stage.
 *    Estimamos 25 × cantidad_de_stages_cargados (ignora misses, es un piso).
 *    Si no hay stages cargados, devolvemos null → el usuario lo ingresa.
 *  - IPSC / Tiro Práctico: imposible de estimar de forma confiable
 *    (los round counts varían por diseño de stage). Devolvemos null.
 *  - Otras disciplinas: null.
 */

const FBI_ROUNDS = 45; // 8 × 5 puntuables + 5 warmup
const STEEL_ROUNDS_PER_STAGE = 25; // 5 strings × 5 platos

export function estimateRoundsFired(
  disciplineCode: string | null | undefined,
  stagesImportedCount: number,
): number | null {
  switch (disciplineCode) {
    case "tiro_fbi":
      return FBI_ROUNDS;
    case "steel_challenge":
      return stagesImportedCount > 0
        ? stagesImportedCount * STEEL_ROUNDS_PER_STAGE
        : null;
    default:
      return null;
  }
}
