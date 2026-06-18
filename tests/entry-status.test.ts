import { describe, expect, it } from "vitest";
import {
  isLikelyAbsent,
  canToggleEntryAbsent,
} from "@/lib/matches/entry-status";

const ME = "me-uuid";
const OTHER = "other-uuid";

describe("isLikelyAbsent", () => {
  it("true solo con puntaje y porcentaje en cero", () => {
    expect(isLikelyAbsent({ match_points: 0, match_percentage: 0 })).toBe(true);
    expect(isLikelyAbsent({ match_points: 1, match_percentage: 0 })).toBe(false);
    expect(isLikelyAbsent({ match_points: 0, match_percentage: 0.5 })).toBe(
      false,
    );
  });
});

describe("canToggleEntryAbsent", () => {
  const edit = { userId: ME, isAdmin: false, importedByUserId: ME, isSelf: false };
  const zero = { is_dq: false, is_absent: false, match_points: 0, match_percentage: 0 };

  it("permite togglear sobre un entry en cero si puede editar", () => {
    expect(canToggleEntryAbsent({ entry: zero, edit })).toBe(true);
  });

  it("permite togglear sobre un entry ya ausente (para revertir)", () => {
    expect(
      canToggleEntryAbsent({
        entry: { ...zero, is_absent: true, match_points: 10, match_percentage: 5 },
        edit,
      }),
    ).toBe(true);
  });

  it("niega sobre DQ", () => {
    expect(
      canToggleEntryAbsent({ entry: { ...zero, is_dq: true }, edit }),
    ).toBe(false);
  });

  it("niega sobre un entry con puntaje (no ausente ni en cero)", () => {
    expect(
      canToggleEntryAbsent({
        entry: { ...zero, match_points: 100, match_percentage: 50 },
        edit,
      }),
    ).toBe(false);
  });

  it("niega si el usuario no puede editar el entry", () => {
    expect(
      canToggleEntryAbsent({
        entry: zero,
        edit: { userId: ME, isAdmin: false, importedByUserId: OTHER, isSelf: false },
      }),
    ).toBe(false);
  });

  it("permite al propio tirador aunque no sea importador", () => {
    expect(
      canToggleEntryAbsent({
        entry: zero,
        edit: { userId: ME, isAdmin: false, importedByUserId: OTHER, isSelf: true },
      }),
    ).toBe(true);
  });
});
