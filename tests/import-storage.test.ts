import { describe, expect, it, vi } from "vitest";
import {
  cleanupImportFiles,
  downloadImportFiles,
  parseUploadedRef,
  MAX_IMPORT_TOTAL_BYTES,
  type UploadedImportFile,
} from "@/lib/import/storage";
import type { TypedSupabaseClient } from "@/lib/supabase/types";

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

/**
 * Fake mínimo del cliente de Supabase: solo la superficie de Storage que
 * usan estos helpers (`download` y `remove`). El mock compartido de
 * `tests/helpers/supabase-mock.ts` cubre `from()` para tablas y no tiene
 * Storage, y extenderlo para dos tests sería más ruido que valor.
 */
function fakeSupabase(opts: {
  download?: (path: string) => { data: Blob | null; error: { message: string } | null };
  remove?: () => { error: { message: string } | null } | never;
}): { client: TypedSupabaseClient; removed: string[][] } {
  const removed: string[][] = [];
  const client = {
    storage: {
      from: () => ({
        download: async (path: string) =>
          opts.download?.(path) ?? { data: null, error: { message: "boom" } },
        remove: async (paths: string[]) => {
          removed.push(paths);
          return opts.remove?.() ?? { error: null };
        },
      }),
    },
  } as unknown as TypedSupabaseClient;
  return { client, removed };
}

function upload(n: number): UploadedImportFile {
  return { path: `${UID}/${OBJ}`, filename: `stage-${n}.pdf` };
}

describe("downloadImportFiles", () => {
  it("devuelve los bytes y preserva el orden de entrada", async () => {
    const { client } = fakeSupabase({
      download: () => ({ data: new Blob(["hola"]), error: null }),
    });

    const out = await downloadImportFiles(client, [
      upload(1),
      upload(2),
      upload(3),
    ]);

    expect(out.map((d) => d.filename)).toEqual([
      "stage-1.pdf",
      "stage-2.pdf",
      "stage-3.pdf",
    ]);
    expect(new TextDecoder().decode(out[0]!.data)).toBe("hola");
  });

  it("tira un error nombrando el archivo si falla la descarga", async () => {
    const { client } = fakeSupabase({
      download: () => ({ data: null, error: { message: "not found" } }),
    });

    await expect(downloadImportFiles(client, [upload(1)])).rejects.toThrow(
      /stage-1\.pdf/,
    );
  });

  it("corta cuando se pasa del presupuesto total de bytes", async () => {
    // Cada archivo pesa poco más de la mitad del techo: el primero entra,
    // el segundo lo cruza. Es el escenario de mandar la misma referencia
    // muchas veces para hacer que el server se traiga cientos de MB.
    const half = Math.ceil(MAX_IMPORT_TOTAL_BYTES / 2) + 1;
    const blob = { size: half, arrayBuffer: async () => new ArrayBuffer(0) };
    const { client } = fakeSupabase({
      download: () => ({ data: blob as unknown as Blob, error: null }),
    });

    await expect(
      downloadImportFiles(client, [upload(1), upload(2)]),
    ).rejects.toThrow(/máximo/i);
  });
});

describe("cleanupImportFiles", () => {
  it("no llama a remove si no hay nada que limpiar", async () => {
    const { client, removed } = fakeSupabase({});
    await cleanupImportFiles(client, []);
    expect(removed).toEqual([]);
  });

  it("borra todos los paths en una sola llamada", async () => {
    const { client, removed } = fakeSupabase({});
    await cleanupImportFiles(client, [upload(1), upload(2)]);
    expect(removed).toEqual([[`${UID}/${OBJ}`, `${UID}/${OBJ}`]]);
  });

  // Contrato explícito del helper: "nunca tira". Si esto se rompe, un
  // import exitoso se convierte en error por un archivo temporal.
  it("no tira si remove devuelve error, pero lo loguea", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeSupabase({
      remove: () => ({ error: { message: "denied" } }),
    });

    await expect(
      cleanupImportFiles(client, [upload(1)]),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("no tira si remove explota", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeSupabase({
      remove: () => {
        throw new Error("network down");
      },
    });

    await expect(
      cleanupImportFiles(client, [upload(1)]),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
