import { describe, expect, it } from "vitest";
import { FakeSupabase } from "./helpers/supabase-mock";
import type { TypedSupabaseClient } from "@/lib/supabase/types";
import {
  deleteMatch,
  updateEntryAbsent,
  updateMatchClub,
  updateMatchMinShots,
} from "@/lib/db/matches";

/**
 * Write helpers in `db/matches.ts` (#196, #197).
 *
 * What these check is that the helpers **report how many rows they
 * touched**. PostgREST returns no error when RLS filters every row of an
 * UPDATE/DELETE: it returns 200 with an empty body. Without that count,
 * the server action cannot tell "the database refused" from "it worked",
 * and ends up auditing and confirming operations that never happened.
 *
 * The mock filters on the same `.eq()` calls the real query uses, so an
 * id that matches nothing produces the same observable result as RLS
 * denying: zero rows, no error.
 */

const ALICE = "alice-uuid";
const BOB = "bob-uuid";

function clientWithMatch(overrides: Record<string, unknown> = {}) {
  const db = new FakeSupabase();
  db.seed("matches", [
    {
      id: "match-1",
      name: "Social 4",
      region: "ARG-TFALP",
      min_shots: null,
      imported_by_user_id: ALICE,
      ...overrides,
    },
  ]);
  return { db, client: db.asClient() as unknown as TypedSupabaseClient };
}

describe("deleteMatch", () => {
  it("reports the deleted row and removes it from the table", async () => {
    const { db, client } = clientWithMatch();

    const { affected, error } = await deleteMatch(client, "match-1");

    expect(error).toBeNull();
    expect(affected).toBe(1);
    expect(db.tables.matches!.rows).toHaveLength(0);
  });

  it("returns affected 0 with no error when it touches nothing", async () => {
    const { db, client } = clientWithMatch();

    const { affected, error } = await deleteMatch(client, "missing-match");

    // This is the exact case that produced the false audit entry: no
    // error, but nothing was deleted.
    expect(error).toBeNull();
    expect(affected).toBe(0);
    expect(db.tables.matches!.rows).toHaveLength(1);
  });
});

describe("updateMatchClub", () => {
  it("updates a match imported by SOMEONE ELSE (regression for #197)", async () => {
    // The admin case. The previous version filtered by
    // `.eq("imported_by_user_id", userId)`, so this affected 0 rows and an
    // admin could not fill in the club of someone else's match — even
    // though RLS (matches_update_admin, 0014) and canEditMatch allowed it.
    const { db, client } = clientWithMatch({ imported_by_user_id: BOB });

    const { affected, error } = await updateMatchClub(
      client,
      "match-1",
      "ARG-TFABA",
    );

    expect(error).toBeNull();
    expect(affected).toBe(1);
    expect(db.tables.matches!.rows[0]!.region).toBe("ARG-TFABA");
  });

  it("accepts null to leave the club unspecified", async () => {
    const { db, client } = clientWithMatch();

    const { affected } = await updateMatchClub(client, "match-1", null);

    expect(affected).toBe(1);
    expect(db.tables.matches!.rows[0]!.region).toBeNull();
  });

  it("returns affected 0 with no error when it touches nothing", async () => {
    const { client } = clientWithMatch();

    const { affected, error } = await updateMatchClub(client, "missing-match", "X");

    expect(error).toBeNull();
    expect(affected).toBe(0);
  });
});

describe("updateMatchMinShots", () => {
  it("reports the updated row", async () => {
    const { db, client } = clientWithMatch();

    const { affected } = await updateMatchMinShots(client, "match-1", 45);

    expect(affected).toBe(1);
    expect(db.tables.matches!.rows[0]!.min_shots).toBe(45);
  });

  it("returns affected 0 with no error when it touches nothing", async () => {
    const { client } = clientWithMatch();

    const { affected, error } = await updateMatchMinShots(client, "missing-match", 45);

    expect(error).toBeNull();
    expect(affected).toBe(0);
  });
});

describe("updateEntryAbsent", () => {
  it("reports the updated row", async () => {
    const db = new FakeSupabase();
    db.seed("match_entries", [{ id: "entry-1", is_absent: false }]);
    const client = db.asClient() as unknown as TypedSupabaseClient;

    const { affected } = await updateEntryAbsent(client, "entry-1", true);

    expect(affected).toBe(1);
    expect(db.tables.match_entries!.rows[0]!.is_absent).toBe(true);
  });

  it("returns affected 0 with no error when it touches nothing", async () => {
    const db = new FakeSupabase();
    db.seed("match_entries", [{ id: "entry-1", is_absent: false }]);
    const client = db.asClient() as unknown as TypedSupabaseClient;

    const { affected, error } = await updateEntryAbsent(client, "missing-entry", true);

    expect(error).toBeNull();
    expect(affected).toBe(0);
  });
});
