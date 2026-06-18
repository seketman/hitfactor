import { ImportError } from "./import-error";

export function requireDivision(
  divisionByCode: Map<string, number>,
  code: string,
): number {
  const id = divisionByCode.get(code);
  if (!id) {
    throw new ImportError(
      `División no reconocida: "${code}". Pedile a un admin que la agregue.`,
      "UNKNOWN_DIVISION",
    );
  }
  return id;
}
