import { describe, expect, it } from "vitest";
import { parseUploadedRef } from "@/lib/import/storage";

/**
 * `parseUploadedRef` es la puerta de entrada del server action a input
 * que arma el cliente: desde que los archivos se suben a Storage, lo que
 * cruza al server es un `{ path, filename }` en JSON. Las policies de
 * RLS ya impiden leer la carpeta de otro usuario, pero esta validación
 * es la primera capa y la que da el error claro.
 */

const UID = "11111111-1111-4111-8111-111111111111";
const OBJ = "22222222-2222-4222-8222-222222222222";

function ref(path: string, filename = "reporte.pdf"): string {
  return JSON.stringify({ path, filename });
}

describe("parseUploadedRef", () => {
  it("acepta un path con la forma <uid>/<uuid>.<ext>", () => {
    expect(parseUploadedRef(ref(`${UID}/${OBJ}.pdf`))).toEqual({
      path: `${UID}/${OBJ}.pdf`,
      filename: "reporte.pdf",
    });
  });

  it("acepta las extensiones de texto además de pdf", () => {
    for (const ext of ["html", "htm", "csv"]) {
      expect(parseUploadedRef(ref(`${UID}/${OBJ}.${ext}`))).not.toBeNull();
    }
  });

  it("acepta un path sin extensión", () => {
    expect(parseUploadedRef(ref(`${UID}/${OBJ}`))).not.toBeNull();
  });

  it("rechaza JSON inválido", () => {
    expect(parseUploadedRef("no soy json")).toBeNull();
    expect(parseUploadedRef("")).toBeNull();
  });

  it("rechaza un objeto sin los campos esperados", () => {
    expect(parseUploadedRef(JSON.stringify({ path: `${UID}/${OBJ}.pdf` }))).toBeNull();
    expect(parseUploadedRef(JSON.stringify({ filename: "x.pdf" }))).toBeNull();
    expect(parseUploadedRef(JSON.stringify({ path: 42, filename: "x.pdf" }))).toBeNull();
    expect(parseUploadedRef(JSON.stringify(null))).toBeNull();
    expect(parseUploadedRef(JSON.stringify([]))).toBeNull();
  });

  it("rechaza path traversal", () => {
    expect(parseUploadedRef(ref(`${UID}/../${OBJ}.pdf`))).toBeNull();
    expect(parseUploadedRef(ref(`../../etc/passwd`))).toBeNull();
    expect(parseUploadedRef(ref(`${UID}/sub/${OBJ}.pdf`))).toBeNull();
  });

  it("rechaza un path que no arranca con un uid con forma de uuid", () => {
    expect(parseUploadedRef(ref(`admin/${OBJ}.pdf`))).toBeNull();
    expect(parseUploadedRef(ref(`${OBJ}.pdf`))).toBeNull();
    expect(parseUploadedRef(ref(""))).toBeNull();
  });

  it("rechaza un filename vacío o absurdamente largo", () => {
    expect(parseUploadedRef(ref(`${UID}/${OBJ}.pdf`, ""))).toBeNull();
    expect(
      parseUploadedRef(ref(`${UID}/${OBJ}.pdf`, "a".repeat(256))),
    ).toBeNull();
  });
});
