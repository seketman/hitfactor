import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Behavioural coverage for `0026_feedback_notification_trail.sql` (#288).
 *
 * The `delivery` column of `ops.feedback_delivery_status` is a contract, not
 * an implementation detail: `supabase/functions/README.md` documents every one
 * of its values as the thing an operator reads to decide whether feedback went
 * missing. Nothing executed it. Reading the SQL was the only review available,
 * and reading it missed three defects that review then found — a failure with
 * only `error_msg` set was labelled "outcome not recorded" while the reason sat
 * in the next column; `pending` was tested before the unattributed case and hid
 * it for an hour; and a `response_lost` verdict could never be corrected by an
 * answer that arrived late. Each is one wrong branch, and each is invisible
 * until somebody runs it.
 *
 * So it runs, against a real Postgres compiled to wasm. The migration is
 * applied verbatim — not excerpted, not paraphrased — so a change to the file
 * is a change to what these tests execute.
 *
 * **What the stubs below are, and what that costs.** `net`,
 * `supabase_functions` and `cron` belong to Supabase and pg_net, and none of
 * them exist here. They are recreated from their published definitions
 * (`supabase_functions.hooks` from `docker/volumes/db/webhooks.sql`) with the
 * columns this migration reads. That means these tests verify the migration's
 * own logic and nothing about the platform: if Supabase changes the shape of
 * `hooks`, the stub keeps agreeing with the migration and both are wrong
 * together. The half that cannot be tested from here stays where it already
 * was — the two-part manual check in `supabase/functions/README.md`.
 */

/**
 * Old enough that the view will judge a delivery rather than leave it
 * pending: past `ops.settle_window()` (1h) plus two `ops.sweep_interval()`
 * runs (10m), with margin. Move either and this has to move with it — SQL
 * functions are not readable from here without a query.
 */
const SETTLED_MINUTES = 180;

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/0026_feedback_notification_trail.sql"),
  "utf8",
);

/**
 * 0027, which replaces the sweep with one that correlates a response to its
 * hook by time as well as by id.
 *
 * Applied separately rather than folded into `MIGRATION` because the
 * precondition tests below run 0026 on its own — they are about what 0026
 * refuses to install on, and 0027 has nothing to say about that.
 */
const FIX = readFileSync(
  join(process.cwd(), "supabase/migrations/0027_correlate_sweep_join_by_time.sql"),
  "utf8",
);

/**
 * The platform objects the migration reads, as the platform defines them.
 *
 * `cron.schedule` and `cron.unschedule` record their calls instead of doing
 * anything, which is also how the migration's own precondition gets exercised:
 * it looks for `cron.schedule(text,text,text)` by exact signature, so a stub
 * with the wrong arity would fail the migration here rather than pass quietly.
 */
const PLATFORM = `
  create schema net;
  create table net._http_response (
    id            bigint primary key,
    status_code   integer,
    content_type  text,
    headers       jsonb,
    content       text,
    timed_out     boolean,
    error_msg     text,
    created       timestamptz not null default now()
  );

  create schema supabase_functions;
  create table supabase_functions.hooks (
    id             bigserial primary key,
    hook_table_id  integer     not null,
    hook_name      text        not null,
    created_at     timestamptz not null default now(),
    request_id     bigint
  );

  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text, schedule text, command text);
  create function cron.schedule(job_name text, schedule text, command text)
    returns bigint language sql as
    $$ insert into cron.job (jobname, schedule, command)
       values (job_name, schedule, command) returning jobid $$;
  create function cron.unschedule(job_name text) returns boolean language sql as
    $$ delete from cron.job where jobname = job_name returning true $$;

  -- Only the columns 0026 touches. The real table is in 0001.
  create table public.feedback (
    id         bigserial primary key,
    type       text        not null default 'bug',
    message    text        not null default 'x',
    created_at timestamptz not null default now()
  );

  -- 0025's trigger, by the name 0026 checks for. It does nothing here:
  -- the tests write hooks rows themselves, because what the real trigger
  -- calls (supabase_functions.http_request) is platform code this cannot
  -- run. The name and the table it sits on are the part under test.
  create function public.feedback_to_telegram_stub() returns trigger
    language plpgsql as $$ begin return new; end $$;
  create trigger feedback_to_telegram after insert on public.feedback
    for each row execute function public.feedback_to_telegram_stub();

  -- Roles the migration revokes from. They exist on every Supabase project.
  create role anon;
  create role authenticated;
`;

let db: PGlite;

/** Inserts a feedback row and returns its id. */
async function submitFeedback(ageMinutes = 0): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `insert into public.feedback (created_at)
     values (now() - ($1 || ' minutes')::interval)
     returning id`,
    [String(ageMinutes)],
  );
  return rows[0]!.id;
}

/**
 * Fires the webhook for a feedback row, the way
 * `supabase_functions.http_request` does: a hooks row carrying the `now()` of
 * the transaction that inserted the feedback, which is the whole basis of the
 * attribution the sweep performs.
 *
 * The timestamp is copied inside the database, never through JavaScript. A
 * `Date` holds milliseconds and `timestamptz` holds microseconds, so a round
 * trip through the client would quietly round the one value these tests exist
 * to compare — and the join under test is an equality, not a window.
 */
async function fireHook(
  feedbackId: number,
  requestId: number | null,
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `insert into supabase_functions.hooks
       (hook_table_id, hook_name, created_at, request_id)
     select 'public.feedback'::regclass::oid::int, 'feedback_to_telegram',
            f.created_at, $2
     from public.feedback f
     where f.id = $1
     returning id`,
    [feedbackId, requestId],
  );
  return rows[0]!.id;
}

/** Writes what pg_net recorded for a request. */
async function pgNetAnswered(
  requestId: number,
  answer: {
    statusCode?: number | null;
    timedOut?: boolean | null;
    errorMsg?: string | null;
    content?: string | null;
  },
): Promise<void> {
  await db.query(
    `insert into net._http_response (id, status_code, timed_out, error_msg, content)
     values ($1, $2, $3, $4, $5)`,
    [
      requestId,
      answer.statusCode ?? null,
      answer.timedOut ?? null,
      answer.errorMsg ?? null,
      answer.content ?? null,
    ],
  );
}

/**
 * Ages a single-row fixture — the feedback, its hook and its log row —
 * keeping all three timestamps identical.
 *
 * Two separate `now() - interval '91 days'` statements do not land on the
 * same microsecond, and everything these tests exercise joins on an exact
 * equality, so aging the rows independently makes the outcome depend on
 * clock resolution. It was flaky exactly that way: the same code passed and
 * failed on consecutive runs, according to whether two statements fell in
 * the same tick. The timestamps are copied in SQL, from one source, for the
 * same reason `fireHook` does it.
 */
async function ageFixture(days: number): Promise<void> {
  const { rows } = await db.query("select id from public.feedback");
  if (rows.length !== 1) {
    throw new Error(
      `ageFixture expects a single feedback row, found ${rows.length}. It ages ` +
        "whatever `limit 1` returns, which for more than one row is a coin toss.",
    );
  }
  await db.query(
    "update public.feedback set created_at = now() - ($1 || ' days')::interval",
    [String(days)],
  );
  await db.exec(`
    update supabase_functions.hooks
      set created_at = (select f.created_at from public.feedback f limit 1);
    update ops.feedback_notification_log
      set hook_created_at = (select f.created_at from public.feedback f limit 1);
  `);
}

/**
 * Writes a response for `requestId` at a known offset from its own hook,
 * computed in SQL from the hook's own `created_at`.
 *
 * The offset is what the correlation window is about, so it must not go
 * through a JS `Date` — the same rounding trap `ageFixture` documents.
 *
 * Call it *after* any `ageFixture`, not before: it measures from the hook's
 * timestamp as it stands, so moving the hook afterwards moves the offset with
 * it. Getting that backwards put a "23 hours" response 71 hours out.
 */
async function pgNetAnsweredAfter(
  requestId: number,
  offset: string,
  statusCode: number,
): Promise<void> {
  await db.query(
    `insert into net._http_response (id, status_code, content, created)
     select $1, $2, '{"ok":true}',
            h.created_at + $3::interval
     from supabase_functions.hooks h
     where h.request_id = $1`,
    [requestId, statusCode, offset],
  );
}

async function sweep(): Promise<number> {
  const { rows } = await db.query<{ written: number }>(
    "select ops.sweep_feedback_notifications() as written",
  );
  return rows[0]!.written;
}

async function deliveryOf(feedbackId: number): Promise<string> {
  const { rows } = await db.query<{ delivery: string }>(
    "select delivery from ops.feedback_delivery_status where feedback_id = $1",
    [feedbackId],
  );
  return rows[0]!.delivery;
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(PLATFORM);
  await db.exec(MIGRATION);
  await db.exec(FIX);
});

beforeEach(async () => {
  // Rows, not the cluster. `restart identity` keeps ids predictable so a
  // hook's `request_id` can be written by hand above.
  await db.exec(`
    truncate public.feedback, supabase_functions.hooks,
             net._http_response, ops.feedback_notification_log
      restart identity;
  `);
  // A fresh heartbeat, so a test that never sweeps still looks at a live
  // sweep rather than inheriting the last test's staleness.
  await db.exec(`
    insert into ops.sweep_heartbeat (only_row, last_run_at) values (true, now())
    on conflict (only_row) do update set last_run_at = now();
  `);
});

describe("0026 — the migration itself", () => {
  it("schedules the sweep", async () => {
    // Filtered by name rather than asserting the whole table: another test
    // in this file re-applies the migration against the same database, and
    // `beforeEach` does not reset `cron.job`. Reading only this row keeps
    // the assertion true whatever order the file runs in.
    const { rows } = await db.query<{ jobname: string; schedule: string }>(
      "select jobname, schedule from cron.job where jobname = $1",
      ["sweep-feedback-notifications"],
    );
    expect(rows).toEqual([
      { jobname: "sweep-feedback-notifications", schedule: "*/5 * * * *" },
    ]);
  });

  it("aborts rather than installing a log nothing fills", async () => {
    const bare = await PGlite.create();
    await bare.exec(PLATFORM);
    await bare.exec("drop function cron.schedule(text, text, text)");

    await expect(bare.exec(MIGRATION)).rejects.toThrow(/pg_cron is not installed/);

    // The point of aborting: no empty table left behind to read as healthy.
    const { rows } = await bare.query(
      "select 1 from pg_catalog.pg_tables where schemaname = 'ops'",
    );
    expect(rows).toEqual([]);
  });

  it("applies twice without complaint", async () => {
    // Its own database, like the precondition tests above. Re-running 0026
    // reinstalls its own `create or replace` of the sweep — the pre-0027
    // version — so doing this on the shared instance left every later test
    // depending on declaration order and a comment to put the fix back.
    // Isolation removes the dependency instead of documenting it.
    const bare = await PGlite.create();
    await bare.exec(PLATFORM);
    await bare.exec(MIGRATION);
    await bare.exec(FIX);

    await expect(bare.exec(MIGRATION)).resolves.toBeDefined();
    await expect(bare.exec(FIX)).resolves.toBeDefined();

    const { rows } = await bare.query("select jobname from cron.job");
    expect(rows).toHaveLength(1);
  });

  it("takes `ops` back out of reach of the app's roles", async () => {
    // Asserting the privilege is absent proves nothing on its own: Postgres
    // grants none on a new schema, so that assertion passes just as well
    // with the `revoke` lines deleted from the migration. Granting first is
    // what gives the test something to observe.
    const bare = await PGlite.create();
    await bare.exec(PLATFORM);
    await bare.exec(`
      create schema ops;
      grant usage on schema ops to anon, authenticated;
    `);

    for (const role of ["anon", "authenticated"]) {
      const { rows } = await bare.query<{ granted: boolean }>(
        "select pg_catalog.has_schema_privilege($1, 'ops', 'USAGE') as granted",
        [role],
      );
      expect(rows[0]!.granted, `${role} should start with access`).toBe(true);
    }

    await bare.exec(MIGRATION);

    for (const role of ["anon", "authenticated"]) {
      const { rows } = await bare.query<{ granted: boolean }>(
        "select pg_catalog.has_schema_privilege($1, 'ops', 'USAGE') as granted",
        [role],
      );
      expect(rows[0]!.granted, `${role} can still reach ops`).toBe(false);
    }
  });

  it("refuses to install without pg_net or Database Webhooks", async () => {
    const bare = await PGlite.create();
    await bare.exec(PLATFORM);
    await bare.exec("drop table supabase_functions.hooks");

    await expect(bare.exec(MIGRATION)).rejects.toThrow(
      /pg_net or Database Webhooks are not enabled/,
    );
  });

  it("refuses to install when the trigger exists but is disabled", async () => {
    // A disabled trigger passes an existence check and fires nothing, which
    // installs a sweep that matches no hook and leaves an empty log — the
    // same healthy-looking nothing as no trigger at all.
    const bare = await PGlite.create();
    await bare.exec(PLATFORM);
    await bare.exec(
      "alter table public.feedback disable trigger feedback_to_telegram",
    );

    await expect(bare.exec(MIGRATION)).rejects.toThrow(
      /feedback_to_telegram trigger does not exist/,
    );
  });

  it("refuses to install without the trigger it exists to watch", async () => {
    // The platform tables come from the extensions, not from 0025. A
    // project with a webhook of any other kind has them, so checking for
    // them would install a sweep that matches no hook and leaves an empty
    // log — the healthy-looking nothing this whole file is about.
    const bare = await PGlite.create();
    await bare.exec(PLATFORM);
    await bare.exec("drop trigger feedback_to_telegram on public.feedback");

    await expect(bare.exec(MIGRATION)).rejects.toThrow(
      /feedback_to_telegram trigger does not exist/,
    );
  });
});

describe("delivery — what an operator is told", () => {
  it("reports a Telegram acceptance as delivered", async () => {
    const f = await submitFeedback();
    await fireHook(f, 1);
    await pgNetAnswered(1, { statusCode: 200, content: '{"ok":true}' });
    await sweep();

    expect(await deliveryOf(f)).toBe("delivered");
  });

  it("reports Telegram's own rejection with its status", async () => {
    const f = await submitFeedback();
    await fireHook(f, 1);
    await pgNetAnswered(1, {
      statusCode: 500,
      content: '{"ok":false,"error":"chat not found"}',
    });
    await sweep();

    expect(await deliveryOf(f)).toBe("failed: HTTP 500");
  });

  it("reports a pg_net timeout as a timeout, not as silence", async () => {
    const f = await submitFeedback();
    await fireHook(f, 1);
    // A pg_net timeout writes neither status_code nor content.
    await pgNetAnswered(1, { timedOut: true });
    await sweep();

    expect(await deliveryOf(f)).toBe(
      "failed: pg_net gave up before the function answered",
    );
  });

  it("reports a connection-level failure with the reason pg_net recorded", async () => {
    const f = await submitFeedback();
    await fireHook(f, 1);
    // DNS, refused, TLS: error_msg alone, no status code, not timed out.
    await pgNetAnswered(1, { timedOut: false, errorMsg: "dns error" });
    await sweep();

    expect(await deliveryOf(f)).toBe("failed: dns error");
  });

  it("distinguishes a call that was never dispatched from a purged answer", async () => {
    const f = await submitFeedback(SETTLED_MINUTES);
    await fireHook(f, null);
    await sweep();

    expect(await deliveryOf(f)).toBe(
      "failed: never dispatched, no pg_net request id",
    );
  });

  it("says the answer was purged when a settled hook has none", async () => {
    const f = await submitFeedback(SETTLED_MINUTES);
    await fireHook(f, 1);
    await sweep();

    expect(await deliveryOf(f)).toBe(
      "unknown: the answer was purged before a sweep read it",
    );
  });

  it("admits it does not know when pg_net recorded nothing useful", async () => {
    const f = await submitFeedback();
    await fireHook(f, 1);
    // A response row with no status, no timeout and no error. Not expected
    // from pg_net, which is the reason the branch says "unknown" rather than
    // picking one of the failures it might have been.
    await pgNetAnswered(1, {});
    await sweep();

    expect(await deliveryOf(f)).toBe("unknown: attempt recorded, outcome not");
  });

  it("holds off on judging a delivery nothing has swept yet", async () => {
    // The hook has to exist for this to be pending at all: the trigger
    // writes it in the same transaction as the feedback, so its absence is
    // decided immediately and is a different answer entirely. Only the
    // *outcome* is worth waiting for.
    const f = await submitFeedback();
    await fireHook(f, 1);

    expect(await deliveryOf(f)).toBe("pending: not swept yet");
  });

  it("names a dropped trigger at once, without waiting out the window", async () => {
    // No hook, seconds old. Nothing to wait for — a trigger that did not
    // fire in the inserting transaction is never going to. This used to
    // read as `pending` for a full hour.
    const f = await submitFeedback();

    expect(await deliveryOf(f)).toBe("NO DELIVERY ATTEMPTED");
  });

  it("raises the alarm when no delivery was ever attempted", async () => {
    const f = await submitFeedback(SETTLED_MINUTES);
    await sweep();

    expect(await deliveryOf(f)).toBe("NO DELIVERY ATTEMPTED");
  });
});

describe("attribution — the timestamp inference", () => {
  it("ties a delivery to the row that fired it", async () => {
    const a = await submitFeedback(10);
    const b = await submitFeedback(5);
    await fireHook(a, 1);
    await fireHook(b, 2);
    await pgNetAnswered(1, { statusCode: 200 });
    await pgNetAnswered(2, { statusCode: 500 });
    await sweep();

    expect(await deliveryOf(a)).toBe("delivered");
    expect(await deliveryOf(b)).toBe("failed: HTTP 500");
  });

  it("declines to guess when one transaction inserts two rows", async () => {
    // Same `created_at` is what a single transaction produces: `now()` is the
    // transaction timestamp. Neither hook can be told from the other.
    const { rows } = await db.query<{ id: number; created_at: Date }>(
      `insert into public.feedback (created_at)
       values (now()), (now()) returning id, created_at`,
    );
    const [a, b] = rows;
    expect(a!.created_at.getTime()).toBe(b!.created_at.getTime());

    await fireHook(a!.id, 1);
    await fireHook(b!.id, 2);
    await pgNetAnswered(1, { statusCode: 200 });
    await pgNetAnswered(2, { statusCode: 200 });
    await sweep();

    const { rows: logged } = await db.query<{ feedback_id: number | null }>(
      "select feedback_id from ops.feedback_notification_log",
    );
    expect(logged).toHaveLength(2);
    // Never a wrong id. Null is the honest answer.
    expect(logged.every((r) => r.feedback_id === null)).toBe(true);
  });

  it("surfaces an unattributed delivery instead of calling it pending", async () => {
    // The regression: an unattributed row does not join, so this feedback
    // looks unswept — and `pending` answered first for a whole hour.
    const { rows } = await db.query<{ id: number; created_at: Date }>(
      `insert into public.feedback (created_at)
       values (now()), (now()) returning id, created_at`,
    );
    await fireHook(rows[0]!.id, 1);
    await fireHook(rows[1]!.id, 2);
    await pgNetAnswered(1, { statusCode: 200 });
    await pgNetAnswered(2, { statusCode: 200 });
    await sweep();

    expect(await deliveryOf(rows[0]!.id)).toBe(
      "unknown: a delivery at this timestamp could not be attributed",
    );
  });
});

describe("the sweep", () => {
  it("archives what pg_net holds and leaves it alone afterwards", async () => {
    const f = await submitFeedback();
    await fireHook(f, 1);
    await pgNetAnswered(1, { statusCode: 200, content: '{"ok":true}' });

    expect(await sweep()).toBe(1);
    // The archive outlives the source.
    await db.query("delete from net._http_response");
    expect(await sweep()).toBe(0);
    expect(await deliveryOf(f)).toBe("delivered");
  });

  it("lets a late answer overturn a `response_lost` verdict", async () => {
    // The regression: `on conflict do nothing` dropped the real answer and
    // left "purged" standing forever.
    const f = await submitFeedback(SETTLED_MINUTES);
    await fireHook(f, 1);
    await sweep();
    expect(await deliveryOf(f)).toBe(
      "unknown: the answer was purged before a sweep read it",
    );

    await pgNetAnswered(1, { statusCode: 200, content: '{"ok":true}' });
    expect(await sweep()).toBe(1);

    expect(await deliveryOf(f)).toBe("delivered");
  });

  it("never rewrites an answer it already archived", async () => {
    const f = await submitFeedback();
    await fireHook(f, 1);
    await pgNetAnswered(1, { statusCode: 500, content: "chat not found" });
    await sweep();

    // pg_net cannot answer the same request twice; if something ever did,
    // evidence already on file is not the thing that should move.
    await db.query("update net._http_response set status_code = 200 where id = 1");
    expect(await sweep()).toBe(0);
    expect(await deliveryOf(f)).toBe("failed: HTTP 500");
  });

  it("does not wait an hour to record an answer it can already read", async () => {
    const f = await submitFeedback();
    await fireHook(f, 1);
    await pgNetAnswered(1, { statusCode: 200 });
    await sweep();

    const { rows } = await db.query<{ response_lost: boolean }>(
      "select response_lost from ops.feedback_notification_log",
    );
    expect(rows[0]!.response_lost).toBe(false);
  });

  it("leaves an unsettled hook alone rather than calling it lost", async () => {
    const f = await submitFeedback();
    await fireHook(f, 1);

    expect(await sweep()).toBe(0);
    expect(await deliveryOf(f)).toBe("pending: not swept yet");
  });

  it("says a delivery went unarchived while the sweep is alive", async () => {
    // The regression this guards: with the view reading only the log, a
    // stopped pg_cron made an unswept delivery indistinguishable from a
    // trigger that never fired — and the answer named the trigger.
    const f = await submitFeedback(SETTLED_MINUTES);
    await fireHook(f, 1);
    await pgNetAnswered(1, { statusCode: 200 });
    // No sweep: this is what an operator sees while the job is not running.

    expect(await deliveryOf(f)).toBe(
      "unknown: the sweep is running but this delivery was never archived",
    );
  });

  it("forgets a delivery once it is past answering for", async () => {
    const f = await submitFeedback(SETTLED_MINUTES);
    await fireHook(f, 1);
    await pgNetAnswered(1, { statusCode: 200 });
    await sweep();

    await ageFixture(89);
    await sweep();
    expect(
      (await db.query("select 1 from ops.feedback_notification_log")).rows,
    ).toHaveLength(1);
    expect(await deliveryOf(f)).toBe("delivered");

    await ageFixture(91);
    await sweep();
    expect(
      (await db.query("select 1 from ops.feedback_notification_log")).rows,
    ).toEqual([]);

    // And what the operator is then told. Asserting only that the table
    // emptied misses the half that matters: the hooks row outlives the log
    // row, so the view has to recognise its own retention rather than
    // report a delivery it forgot on purpose as one that went unarchived.
    expect(await deliveryOf(f)).toBe(
      "past retention: a delivery fired; no record is kept this far back",
    );
  });

  it("names a stopped sweep instead of reading meaning into its silence", async () => {
    const f = await submitFeedback(SETTLED_MINUTES);
    await fireHook(f, 1);
    await pgNetAnswered(1, { statusCode: 200 });
    await db.query(
      "update ops.sweep_heartbeat set last_run_at = now() - interval '2 hours'",
    );

    expect(await deliveryOf(f)).toBe(
      "unknown: the sweep is not running — see sweep_last_run_at",
    );
  });

  it("reports a dropped trigger even while the sweep is down", async () => {
    // Both can fail at once, and restarting pg_cron does not fix the
    // second. Reporting only the sweep would hide the alarm that is both
    // more specific and still provable: the hooks table answers this one
    // without any help from the sweep.
    const f = await submitFeedback(SETTLED_MINUTES);
    await db.query(
      "update ops.sweep_heartbeat set last_run_at = now() - interval '2 hours'",
    );

    expect(await deliveryOf(f)).toBe("NO DELIVERY ATTEMPTED");
  });

  it("answers the horizon before the heartbeat, for a sweep that was never alive", async () => {
    // The two branches are adjacent and both plausible-looking, so nothing
    // stopped a future edit from grouping the `unknown:` cases together and
    // swapping them. Swapping them passed all 37 tests before this one
    // existed, and reinstated the bug the branch above exists to prevent:
    // past the horizon there is no record either way, and a stale heartbeat
    // must not dress that up as an outage with a cause.
    //
    // No `sweep()` after aging, deliberately — sweeping refreshes the
    // heartbeat and hides the question entirely.
    const f = await submitFeedback();
    await fireHook(f, 1);
    await ageFixture(200);
    await db.query(
      "update ops.sweep_heartbeat set last_run_at = now() - interval '2 hours'",
    );

    expect(await deliveryOf(f)).toBe(
      "past retention: a delivery fired; no record is kept this far back",
    );
  });

  it("gives the sweep two ticks before calling a gap an anomaly", async () => {
    // A delivery crossing the settle boundary is genuinely unarchived until
    // the next tick. Judged on the settle window alone it would spend those
    // minutes labelled an anomaly on its way to being recorded normally.
    const f = await submitFeedback(65); // past settle (60m), inside two runs (10m)
    await fireHook(f, 1);

    expect(await deliveryOf(f)).toBe("pending: not swept yet");
  });

  it("stops calling it pending once the sweep has had its chance", async () => {
    // The other side of the same boundary, and the reason it is two ticks
    // and not six: the sweep takes a settled row on the very next run, so a
    // row still unrecorded after two is stuck, not waiting. Borrowing the
    // liveness slack here hid that for an extra twenty-five minutes.
    const f = await submitFeedback(75); // past settle + two runs
    await fireHook(f, 1);

    expect(await deliveryOf(f)).toBe(
      "unknown: the sweep is running but this delivery was never archived",
    );
  });

  it("does not cry wolf over a sweep that merely missed a few runs", async () => {
    // Six runs of slack, not two. A restart or a slow minute leaves the
    // heartbeat stale for a while, and an alarm that fires on that is an
    // alarm people learn to ignore — which is how the silence in #288
    // survives being monitored at all.
    const f = await submitFeedback(SETTLED_MINUTES);
    await fireHook(f, 1);
    await db.query(
      "update ops.sweep_heartbeat set last_run_at = now() - interval '20 minutes'",
    );

    expect(await deliveryOf(f)).toBe(
      "unknown: the sweep is running but this delivery was never archived",
    );
  });

  it("treats a heartbeat that was never written as a sweep that is not running", async () => {
    const f = await submitFeedback(SETTLED_MINUTES);
    await fireHook(f, 1);
    await db.query("delete from ops.sweep_heartbeat");

    expect(await deliveryOf(f)).toBe(
      "unknown: the sweep is not running — see sweep_last_run_at",
    );
  });

  it("names a dead sweep even for a delivery that is still fresh", async () => {
    // `pending` would be the wrong answer: nothing is going to sweep it.
    const f = await submitFeedback();
    await fireHook(f, 1);
    await db.query(
      "update ops.sweep_heartbeat set last_run_at = now() - interval '2 hours'",
    );

    expect(await deliveryOf(f)).toBe(
      "unknown: the sweep is not running — see sweep_last_run_at",
    );
  });

  it("does not claim a record was kept when it cannot know that", async () => {
    // A hook already older than retention the first time the sweep sees it
    // is excluded from archiving forever — it only gets older. It is
    // indistinguishable from one archived long ago and since expired, so
    // the label must claim neither. An earlier version called both of them
    // "not a fault".
    const f = await submitFeedback();
    await fireHook(f, 1);
    await ageFixture(200);
    await sweep();

    expect(
      (await db.query("select 1 from ops.feedback_notification_log")).rows,
    ).toEqual([]);
    expect(await deliveryOf(f)).toBe(
      "past retention: a delivery fired; no record is kept this far back",
    );
  });

    it("still trusts a record it already has when the sweep stops", async () => {
    const f = await submitFeedback(SETTLED_MINUTES);
    await fireHook(f, 1);
    await pgNetAnswered(1, { statusCode: 200 });
    await sweep();
    await db.query(
      "update ops.sweep_heartbeat set last_run_at = now() - interval '2 hours'",
    );

    // An archived outcome is a fact, not an inference. A dead sweep does
    // not unmake it.
    expect(await deliveryOf(f)).toBe("delivered");
  });

  it("still reports an ancient trigger outage as one", async () => {
    // Retention expires the log, never `supabase_functions.hooks`. So "no
    // hook at this timestamp" stays true at any age, and an outage from
    // long ago must not age into "no record kept".
    const f = await submitFeedback(SETTLED_MINUTES);
    await db.query(
      "update public.feedback set created_at = now() - interval '200 days'",
    );
    await sweep();

    expect(await deliveryOf(f)).toBe("NO DELIVERY ATTEMPTED");
  });

  it("attributes a lost delivery to the right row, not merely to some row", async () => {
    // Step 2 carries its own copy of the attribution query. Every other
    // test that reaches it has one feedback row in the table, where `=`
    // and `<=` cannot be told apart — so drift in that copy would pass.
    const older = await submitFeedback(SETTLED_MINUTES + 60);
    const newer = await submitFeedback(SETTLED_MINUTES);
    await fireHook(newer, 1);
    // No answer ever arrives: this is step 2's path.
    await sweep();

    const { rows } = await db.query<{ feedback_id: number | null }>(
      "select feedback_id from ops.feedback_notification_log",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.feedback_id).toBe(newer);
    expect(rows[0]!.feedback_id).not.toBe(older);
  });

  it("counts both of its steps in one pass", async () => {
    // `v_total` accumulates across step 1 and step 2. With only ever one
    // of them non-zero, replacing `+=` with `=` would go unnoticed.
    const archived = await submitFeedback(SETTLED_MINUTES);
    const lost = await submitFeedback(SETTLED_MINUTES + 1);
    await fireHook(archived, 1);
    await fireHook(lost, 2);
    await pgNetAnswered(1, { statusCode: 200 });

    expect(await sweep()).toBe(2);
    expect(await deliveryOf(archived)).toBe("delivered");
    expect(await deliveryOf(lost)).toBe(
      "unknown: the answer was purged before a sweep read it",
    );
  });

  it("does not keep rewriting hooks that are past retention", async () => {
    // `supabase_functions.hooks` is never purged, so a hook older than
    // retention matches step 2 forever. Asserting the table ends up empty
    // proves nothing here — step 3 runs last and would delete the row in
    // the same call either way. The written count is what separates "never
    // touched it" from "wrote it and deleted it again", which is the churn
    // this guards: every old hook in the project, every five minutes.
    const f = await submitFeedback();
    await fireHook(f, 1);
    await db.query(
      "update supabase_functions.hooks set created_at = now() - interval '100 days'",
    );

    expect(await sweep()).toBe(0);
    expect(
      (await db.query("select 1 from ops.feedback_notification_log")).rows,
    ).toEqual([]);
  });

  it("records that it ran, even when it found nothing", async () => {
    await db.query("delete from ops.sweep_heartbeat");
    expect(await sweep()).toBe(0);

    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from ops.sweep_heartbeat where last_run_at > now() - interval '1 minute'",
    );
    expect(rows[0]!.n).toBe(1);
  });

  it("will not take an outcome from a response that merely shares an id", async () => {
    // `net._http_response.id` is unique only for the life of the extension.
    // Recreate `pg_net` and the sequence restarts, while
    // `supabase_functions.hooks` keeps every request id the project ever
    // issued — so a response written today can carry the id of a request
    // made months ago. Matching on the id alone hands that old hook this
    // outcome, and the error lands on the worst side: a delivery that failed
    // reported as `delivered`.
    const f = await submitFeedback();
    await fireHook(f, 1);
    await ageFixture(10);

    // Same id, ten days later. Nothing to do with the hook above.
    await pgNetAnswered(1, { statusCode: 200, content: '{"ok":true}' });
    await sweep();

    const { rows } = await db.query<{ status_code: number | null; response_lost: boolean }>(
      "select status_code, response_lost from ops.feedback_notification_log",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status_code).toBeNull();
    expect(rows[0]!.response_lost).toBe(true);
    expect(await deliveryOf(f)).toBe(
      "unknown: the answer was purged before a sweep read it",
    );
  });

  it("takes an answer up to the edge of the correlation window", async () => {
    const f = await submitFeedback();
    await fireHook(f, 1);
    await ageFixture(2);
    await pgNetAnsweredAfter(1, "23 hours", 200);
    await sweep();

    expect(await deliveryOf(f)).toBe("delivered");
  });

  it("will not take an answer from beyond it", async () => {
    // The cost of the bound, stated plainly: a response really belonging to
    // this hook but recorded more than a day later is no longer taken, and
    // the row stays `response_lost`. That needs pg_net to be a day behind,
    // by which point its own TTL would have purged the row anyway — but it
    // is a narrowing of the late-correction path 0026 documents, so it is
    // pinned rather than left to be discovered.
    const f = await submitFeedback();
    await fireHook(f, 1);
    await ageFixture(2);
    await pgNetAnsweredAfter(1, "25 hours", 200);
    await sweep();

    expect(await deliveryOf(f)).toBe(
      "unknown: the answer was purged before a sweep read it",
    );
  });

  it("excludes a response landing exactly on the window", async () => {
    // `<`, not `<=`. One instant, and nothing else in the file pins it.
    const f = await submitFeedback();
    await fireHook(f, 1);
    await ageFixture(2);
    await pgNetAnsweredAfter(1, "24 hours", 200);
    await sweep();

    expect(await deliveryOf(f)).toBe(
      "unknown: the answer was purged before a sweep read it",
    );
  });

  it("still takes an outcome that arrives late but plausibly", async () => {
    // The other side of the bound. Tightening it until a real backlog is
    // excluded would trade a false `delivered` for a false `purged`, which
    // is quieter but no more true.
    const f = await submitFeedback(SETTLED_MINUTES);
    await fireHook(f, 1);
    await pgNetAnswered(1, { statusCode: 200, content: '{"ok":true}' });
    await sweep();

    expect(await deliveryOf(f)).toBe("delivered");
  });

  it("ignores hooks belonging to other triggers", async () => {
    const f = await submitFeedback(SETTLED_MINUTES);
    await db.query(
      `insert into supabase_functions.hooks
         (hook_table_id, hook_name, created_at, request_id)
       select 'public.feedback'::regclass::oid::int, 'some_other_hook',
              f.created_at, 9
       from public.feedback f where f.id = $1`,
      [f],
    );
    await pgNetAnswered(9, { statusCode: 200 });
    await sweep();

    const { rows } = await db.query("select 1 from ops.feedback_notification_log");
    expect(rows).toEqual([]);
  });
});
