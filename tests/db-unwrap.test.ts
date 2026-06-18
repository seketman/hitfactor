import { describe, expect, it } from "vitest";
import { unwrap } from "@/lib/db/unwrap";

describe("unwrap", () => {
  it("devuelve data cuando no hay error", () => {
    const rows = [{ id: 1 }];
    expect(unwrap({ data: rows, error: null }, "test")).toBe(rows);
  });

  it("pasa data null (maybeSingle sin fila) sin lanzar", () => {
    expect(unwrap({ data: null, error: null }, "test")).toBeNull();
  });

  it("lanza con el contexto cuando hay error", () => {
    expect(() =>
      unwrap({ data: null, error: { message: "permission denied" } }, "getFoo"),
    ).toThrow(/\[db:getFoo\] permission denied/);
  });
});
