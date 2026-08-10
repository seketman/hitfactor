import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { checkDatabase } from "@/lib/health";

/**
 * Public health endpoint for an uptime monitor (#225).
 *
 * `200` when the app renders **and** the database answers, `503` when it
 * does not. Monitors key off the status code, so that distinction is the
 * entire contract.
 *
 * Why not point the monitor at `/es/login`, which is also public and cheap:
 * that page renders perfectly well with PostgREST down. It detects "the app
 * is gone" and misses "the data layer is gone", which is the half that
 * actually broke on 2026-08-07.
 *
 * ## Deliberately not the request-scoped client
 *
 * `lib/supabase/server.ts` reads cookies to carry a session. There is no
 * session here and there must not be one: a probe holding credentials is a
 * credential that expires, and its expiry would look exactly like an
 * outage. This builds a plain anonymous client with `persistSession: false`
 * — no cookies, no refresh, nothing to go stale.
 *
 * ## What the response deliberately does not say
 *
 * Only `status` and one boolean per check. No error text, no versions, no
 * hostnames, no timings. The endpoint is unauthenticated, so everything it
 * returns is returned to everyone; a Postgres error message would hand a
 * stranger the schema. The reason for a failure goes to the server log,
 * where the operator can read it and nobody else can.
 */

/**
 * Without this Next may serve a cached `200` while the database is down —
 * a health check that lies is worse than no health check, because it
 * converts an outage into a silent one.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Missing configuration IS unhealthy, and it has to answer 503 like any
  // other failure. Left to the non-null assertions the rest of the codebase
  // uses, `createClient` would throw and Next would answer 500 — which a
  // monitor still reads as down, but arrives as an unhandled exception with
  // no line saying what was actually wrong. The one endpoint whose job is
  // to explain outages should not be the one that reports them worst.
  const database = url && anonKey
    ? await checkDatabase(
        createClient<Database>(url, anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        }),
      )
    : { ok: false, detail: "NEXT_PUBLIC_SUPABASE_URL or ANON_KEY is unset" };

  if (!database.ok) {
    // The one place the detail is allowed to exist. Vercel keeps function
    // logs, so a failed probe leaves something to read afterwards — which
    // is precisely what the 2026-08-07 incident did not.
    console.error(`[health] database check failed: ${database.detail}`);
  }

  return NextResponse.json(
    {
      status: database.ok ? "ok" : "degraded",
      checks: { database: database.ok },
    },
    {
      status: database.ok ? 200 : 503,
      // Belt and braces with `force-dynamic`: this one also tells any CDN
      // or proxy between the monitor and us not to keep the answer.
      headers: { "cache-control": "no-store" },
    },
  );
}
