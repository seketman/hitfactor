import { describe, expect, it } from "vitest";
import { estimateRoundsFired } from "@/lib/firearms/estimate-rounds";

describe("estimateRoundsFired", () => {
  it("FBI: 45 tiros independientemente de los stages cargados", () => {
    expect(estimateRoundsFired("tiro_fbi", 0)).toBe(45);
    expect(estimateRoundsFired("tiro_fbi", 8)).toBe(45);
  });

  it("Steel: 25 tiros por stage cargado", () => {
    expect(estimateRoundsFired("steel_challenge", 1)).toBe(25);
    expect(estimateRoundsFired("steel_challenge", 5)).toBe(125);
    expect(estimateRoundsFired("steel_challenge", 8)).toBe(200);
  });

  it("Steel sin stages cargados: null (no podemos estimar)", () => {
    expect(estimateRoundsFired("steel_challenge", 0)).toBeNull();
  });

  it("IPSC: null (round count varía por diseño de stage)", () => {
    expect(estimateRoundsFired("ipsc", 0)).toBeNull();
    expect(estimateRoundsFired("ipsc", 6)).toBeNull();
  });

  it("disciplina desconocida o ausente: null", () => {
    expect(estimateRoundsFired("combat_solutions", 4)).toBeNull();
    expect(estimateRoundsFired(null, 4)).toBeNull();
    expect(estimateRoundsFired(undefined, 4)).toBeNull();
  });
});
