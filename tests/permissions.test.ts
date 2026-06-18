import { describe, expect, it } from "vitest";
import { canEditMatch, canEditEntry } from "@/lib/permissions";

const ALICE = "alice-uuid";
const BOB = "bob-uuid";

describe("canEditMatch", () => {
  it("permite al importador del match", () => {
    expect(
      canEditMatch({ userId: ALICE, isAdmin: false, importedByUserId: ALICE }),
    ).toBe(true);
  });

  it("permite a un admin aunque no sea el importador", () => {
    expect(
      canEditMatch({ userId: ALICE, isAdmin: true, importedByUserId: BOB }),
    ).toBe(true);
  });

  it("niega a quien no es ni importador ni admin", () => {
    expect(
      canEditMatch({ userId: ALICE, isAdmin: false, importedByUserId: BOB }),
    ).toBe(false);
  });

  it("niega cuando el match no tiene importador (importedByUserId null)", () => {
    expect(
      canEditMatch({ userId: ALICE, isAdmin: false, importedByUserId: null }),
    ).toBe(false);
  });
});

describe("canEditEntry", () => {
  const base = { userId: ALICE, isAdmin: false, importedByUserId: BOB };

  it("hereda los permisos de canEditMatch (importador/admin)", () => {
    expect(canEditEntry({ ...base, importedByUserId: ALICE, isSelf: false })).toBe(
      true,
    );
    expect(canEditEntry({ ...base, isAdmin: true, isSelf: false })).toBe(true);
  });

  it("permite al propio tirador aunque no sea importador ni admin", () => {
    expect(canEditEntry({ ...base, isSelf: true })).toBe(true);
  });

  it("niega cuando no es importador, admin ni el propio tirador", () => {
    expect(canEditEntry({ ...base, isSelf: false })).toBe(false);
  });
});
