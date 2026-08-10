import { describe, expect, it, vi } from "vitest";
import { DB_PROBE_TIMEOUT_MS, checkDatabase } from "@/lib/health";
import type { TypedSupabaseClient } from "@/lib/supabase/types";

/**
 * The probe's job is to tell "the data layer answered" from "it did not",
 * and the ways it can get that wrong are all silent: reporting healthy
 * while the database is unreachable turns an outage into an outage nobody
 * hears about, which is the state #225 exists to leave.
 */

/**
 * Minimal stand-in for the client: `checkDatabase` only ever calls
 * `.from().select().abortSignal()`, and `FakeSupabase` models neither
 * `head` nor `abortSignal`. Hand-rolling the three links keeps the fake
 * honest about what is actually exercised.
 */
function clientReturning(
  result: { error: { message: string } | null } | (() => never),
): TypedSupabaseClient {
  return {
    from: () => ({
      select: () => ({
        abortSignal: async () => {
          if (typeof result === "function") result();
          return result;
        },
      }),
    }),
  } as unknown as TypedSupabaseClient;
}

describe("checkDatabase", () => {
  it("is healthy when the query comes back without an error", async () => {
    await expect(checkDatabase(clientReturning({ error: null }))).resolves.toEqual(
      { ok: true },
    );
  });

  /**
   * The probe runs unauthenticated and `disciplines` is readable only `to
   * authenticated`, so RLS filters every row and the result is empty. That
   * is the **normal healthy case**, not a failure: an empty set still
   * proves the request reached PostgREST and Postgres ran the policy.
   *
   * Getting this backwards would be the worst possible bug here — a probe
   * that reports down while everything is fine trains its owner to ignore
   * it, and then it is useless on the day it is right.
   */
  it("treats an empty result as healthy, because RLS filtering is expected", async () => {
    const result = await checkDatabase(clientReturning({ error: null }));
    expect(result.ok).toBe(true);
  });

  it("is unhealthy when PostgREST returns an error", async () => {
    const result = await checkDatabase(
      clientReturning({ error: { message: 'relation "disciplines" does not exist' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("does not exist");
  });

  /**
   * An abort surfaces as a thrown exception, not as `error`. Without the
   * catch it would escape the route handler as a 500 — which a monitor
   * reads as "down" by luck rather than by design, and which loses the
   * reason on the way out.
   */
  it("is unhealthy when the probe throws instead of returning an error", async () => {
    const result = await checkDatabase(
      clientReturning(() => {
        throw new Error("The operation was aborted");
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("aborted");
  });

  it("survives something that is not an Error being thrown", async () => {
    const result = await checkDatabase(
      clientReturning(() => {
        // A bare string, not an Error: `fetch` and friends throw those, and
        // `String(e)` is what keeps the log readable instead of "[object
        // Object]".
        throw "socket hang up";
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toBe("socket hang up");
  });

  /**
   * The timeout has to be bounded and it has to be shorter than whatever
   * is polling us. Unbounded, a hung connection hangs the probe, and the
   * monitor reports its own timeout — indistinguishable from the app being
   * unreachable, exactly when telling those apart is the point.
   */
  it("bounds the wait well below a monitor's own timeout", () => {
    expect(DB_PROBE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DB_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  it("passes an abort signal carrying that timeout", async () => {
    // Typed parameter so `mock.calls[0][0]` is the signal and not `never`.
    const abortSignal = vi.fn(async (_signal: AbortSignal) => ({ error: null }));
    const client = {
      from: () => ({ select: () => ({ abortSignal }) }),
    } as unknown as TypedSupabaseClient;

    await checkDatabase(client);

    // Without a signal the timeout constant would be decorative.
    expect(abortSignal).toHaveBeenCalledOnce();
    expect(abortSignal.mock.calls[0]![0]).toBeInstanceOf(AbortSignal);
  });
});
