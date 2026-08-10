import { beforeEach, describe, expect, it } from "vitest";
import { FakeSupabase } from "./helpers/supabase-mock";
import { resolveImpersonation } from "@/lib/admin/impersonation";
import type { TypedSupabaseClient } from "@/lib/supabase/types";

/**
 * Admin impersonation (`?asProfile`) was the only sensitive action in the
 * app leaving no trace (#208). The gate worked; nothing recorded that it
 * had been passed.
 *
 * So these tests are mostly about the audit row, not the gate: the gate
 * failing is loud (the admin sees their own dashboard), while the log
 * failing is silent, which is the whole reason the gap existed.
 */

// Real UUIDs, not "admin-1": `resolveImpersonation` checks the shape of
// `asProfile` before querying, because Postgres errors on a malformed uuid
// instead of returning no rows. Placeholder ids would exercise the reject
// path and never reach the code under test.
const ADMIN = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";
/** Well-formed but nobody: the "valid shape, no such profile" case. */
const ABSENT = "33333333-3333-4333-8333-333333333333";

function build(): FakeSupabase {
  const fake = new FakeSupabase();
  fake.seed("profiles", [
    { id: ADMIN, display_name: "The Admin", is_admin: true },
    { id: TARGET, display_name: "Someone Else", is_admin: false },
  ]);
  fake.seed("shooters", [
    { id: "sh-1", full_name: "Someone Else", linked_user_id: TARGET },
    { id: "sh-2", full_name: "Someone Else (alias)", linked_user_id: TARGET },
  ]);
  return fake;
}

let fake: FakeSupabase;
beforeEach(() => {
  fake = build();
});

const client = () => fake.asClient() as unknown as TypedSupabaseClient;
const auditRows = () => fake.table("audit_log").rows;

describe("resolveImpersonation — the gate", () => {
  it("loads the target profile and all of their shooters for an admin", async () => {
    const result = await resolveImpersonation(
      client(),
      { id: ADMIN, isAdmin: true },
      TARGET,
    );

    expect(result.profile?.id).toBe(TARGET);
    expect(result.shooters).toHaveLength(2);
  });

  it("ignores the override for a non-admin", async () => {
    const result = await resolveImpersonation(
      client(),
      { id: "someone", isAdmin: false },
      TARGET,
    );

    expect(result.profile).toBeNull();
    expect(result.shooters).toEqual([]);
  });

  it("resolves to not-impersonating for a profile that does not exist", async () => {
    const result = await resolveImpersonation(
      client(),
      { id: ADMIN, isAdmin: true },
      ABSENT,
    );

    expect(result.profile).toBeNull();
  });

  it("is inert without the parameter", async () => {
    for (const value of [null, undefined, ""]) {
      const result = await resolveImpersonation(
        client(),
        { id: ADMIN, isAdmin: true },
        value,
      );
      expect(result.profile).toBeNull();
    }
  });

  /**
   * `asProfile` is a query-string value heading for a `uuid` column.
   * Postgres rejects a malformed one with an *error*, not an empty result,
   * and `getProfile` runs its result through `unwrap`, which throws — so
   * without the shape check this answers 500 rather than falling back
   * silently, and the URL that triggers it is one an admin can typo.
   */
  it("falls back instead of throwing on a malformed uuid", async () => {
    for (const junk of [
      "whatever",
      "../../etc/passwd",
      "1",
      "not-a-uuid-at-all",
      "'; select 1; --",
    ]) {
      const result = await resolveImpersonation(
        client(),
        { id: ADMIN, isAdmin: true },
        junk,
      );
      expect(result.profile, junk).toBeNull();
    }
  });

  /**
   * The result carries an array, so a shared constant would let one caller
   * mutating it corrupt every later "not impersonating" answer in the
   * process.
   */
  it("does not hand out a shared result object", async () => {
    const a = await resolveImpersonation(
      client(),
      { id: ADMIN, isAdmin: false },
      TARGET,
    );
    a.shooters.push({ id: "injected" } as never);

    const b = await resolveImpersonation(
      client(),
      { id: ADMIN, isAdmin: false },
      TARGET,
    );
    expect(b.shooters).toEqual([]);
  });
});

describe("resolveImpersonation — the audit trail", () => {
  it("records the access, attributed to the admin", async () => {
    await resolveImpersonation(client(), { id: ADMIN, isAdmin: true }, TARGET);

    expect(auditRows()).toHaveLength(1);
    const row = auditRows()[0]!;
    // The actor is the admin, not the person being viewed — the session
    // never changed hands.
    expect(row.user_id).toBe(ADMIN);
    expect(row.action).toBe("admin.view_as");
    expect(row.entity_type).toBe("profile");
    expect(row.entity_id).toBe(TARGET);
  });

  /**
   * The display name is copied into the entry rather than looked up when
   * the log is rendered. The audit log is historical: if the person renames
   * themselves later, the row must still say who was viewed at the time.
   */
  it("snapshots the display name and the scope", async () => {
    await resolveImpersonation(
      client(),
      { id: ADMIN, isAdmin: true },
      TARGET,
      { disciplineCode: "ipsc", divisionCode: "PO" },
    );

    expect(auditRows()[0]!.metadata).toMatchObject({
      profile_display_name: "Someone Else",
      shooter_count: 2,
      discipline_code: "ipsc",
      division_code: "PO",
    });
  });

  it("records the consolidated view as a null scope", async () => {
    await resolveImpersonation(client(), { id: ADMIN, isAdmin: true }, TARGET);

    expect(auditRows()[0]!.metadata).toMatchObject({
      discipline_code: null,
      division_code: null,
    });
  });

  /**
   * The cases that must NOT log are as important as the one that must: an
   * entry written when nothing was viewed would make the log say an admin
   * read data they never saw.
   */
  it("writes nothing when no impersonation happened", async () => {
    await resolveImpersonation(
      client(),
      { id: "someone", isAdmin: false },
      TARGET,
    );
    await resolveImpersonation(
      client(),
      { id: ADMIN, isAdmin: true },
      ABSENT,
    );
    await resolveImpersonation(client(), { id: ADMIN, isAdmin: true }, null);

    expect(auditRows()).toHaveLength(0);
  });

  /**
   * One row per resolution, deliberately — see the module docstring. Each
   * render is another read of that person's data, so an admin browsing
   * three views leaves three rows rather than one.
   */
  it("logs every access, not just the first", async () => {
    for (const discipline of ["ipsc", "tiro_fbi", "steel_challenge"]) {
      await resolveImpersonation(
        client(),
        { id: ADMIN, isAdmin: true },
        TARGET,
        { disciplineCode: discipline },
      );
    }

    expect(auditRows()).toHaveLength(3);
    expect(auditRows().map((r) => (r.metadata as { discipline_code: string }).discipline_code))
      .toEqual(["ipsc", "tiro_fbi", "steel_challenge"]);
  });
});
