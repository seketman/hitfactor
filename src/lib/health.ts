import type { TypedSupabaseClient } from "./supabase/types";

/**
 * Liveness probe backing `GET /api/health` (#225).
 *
 * Exists because nothing was sampling the site. On 2026-08-07 the app
 * served errors for some minutes and recovered on its own; it was noticed
 * only because the maintainer happened to refresh. Nobody could say
 * afterwards whether it had lasted thirty seconds or twenty minutes,
 * because there was no record either way.
 *
 * **Why Vercel's own alerting does not cover this.** Its alerts are
 * *anomalies in the error rate*: for sparse traffic they need on the order
 * of 51 errors, or 5 across two consecutive five-minute windows, before
 * firing. An outage at 4am with no visitors produces **zero requests and
 * therefore zero errors**, so there is no anomaly to detect. Error-rate
 * alerting can only see failures that someone was there to receive. A
 * probe is what generates the traffic — that is the whole point of it.
 *
 * ## What is actually asserted
 *
 * That the data layer *answers*, not that it returns data. The probe runs
 * unauthenticated, and `disciplines` is readable `to authenticated`, so
 * RLS legitimately filters every row and the result is an empty set. That
 * is fine and deliberate: an empty result still proves the request reached
 * PostgREST, that Postgres executed the policy and that the connection is
 * alive. A dropped table, a revoked key, a paused project or an unreachable
 * database all produce an `error` instead — which is the discriminator.
 *
 * Checking rows instead would mean either giving the probe credentials, or
 * opening a table to anonymous reads, to learn less than this does.
 */

export interface HealthCheck {
  ok: boolean;
  /**
   * Reason for a failure, for the server log only. It is never returned to
   * the caller: `/api/health` is public and unauthenticated, so a Postgres
   * error message would hand a stranger the schema and topology.
   */
  detail?: string;
}

/**
 * How long the probe waits before calling the database down.
 *
 * Bounded on purpose. Without it a hung connection makes the probe hang
 * too, and the monitor reports a timeout of its own — indistinguishable
 * from the app being unreachable, right when telling the two apart is what
 * you need. Five seconds is far above a healthy round trip and far below
 * any monitor's own timeout.
 */
export const DB_PROBE_TIMEOUT_MS = 5_000;

export async function checkDatabase(
  supabase: TypedSupabaseClient,
): Promise<HealthCheck> {
  try {
    // `head: true` asks for no rows at all — the response body is empty and
    // only the status matters. The cheapest round trip that still traverses
    // PostgREST, Postgres and RLS.
    //
    // No `count`: it would add a `COUNT(*)` whose result nothing reads.
    // Harmless on a four-row lookup table, but an option carried for no
    // reason is one someone later has to work out the purpose of.
    const { error } = await supabase
      .from("disciplines")
      .select("id", { head: true })
      .abortSignal(AbortSignal.timeout(DB_PROBE_TIMEOUT_MS));

    if (error) return { ok: false, detail: error.message };
    return { ok: true };
  } catch (e) {
    // The abort lands here rather than in `error`, and so does anything
    // thrown below the client (DNS, TLS, fetch). All of them mean the same
    // thing to a monitor: the data layer did not answer.
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
