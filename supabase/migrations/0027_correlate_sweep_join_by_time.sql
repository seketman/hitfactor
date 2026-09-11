-- =====================================================================
-- HitFactor — Tie a delivery's outcome to the delivery, not just to an id
-- =====================================================================
-- `ops.sweep_feedback_notifications()` matched a hook to its answer on
-- `net._http_response.id = supabase_functions.hooks.request_id` and
-- nothing else. That id is a sequence, and a sequence is unique only for
-- the life of its extension: drop and recreate `pg_net` and the counter
-- restarts from one.
--
-- `supabase_functions.hooks` is never purged by anybody, so every request
-- id the project has ever issued is still on file. After a reset, a
-- response created today can carry the same id as a request made months
-- ago, and the join would hand that old hook an outcome belonging to
-- somebody else.
--
-- The direction of the error is what makes it worth a migration of its
-- own. A delivery that failed would be archived as `delivered`, and
-- `ops.feedback_delivery_status` would report it as fine. 0026 exists
-- because a broken notification was invisible; this is the same silence,
-- reached through the thing built to end it.
--
-- Found while verifying 0026 against production. A row from 2026-08-16
-- read `delivered` 26 days later, which should have been impossible with
-- `net._http_response` purging on `pg_net.ttl`. It turned out to be
-- genuine — the response was still there, 51 ms after its hook, and there
-- was only one row in the whole table so nothing could have collided with
-- it. The bug was not real that day. The join that would have let it be
-- real was.
--
-- ---------------------------------------------------------------------
-- Applying it
-- ---------------------------------------------------------------------
-- Paste and run. It replaces one function and touches no data: the rows
-- already in `ops.feedback_notification_log` were written under the old
-- join and are left exactly as they are. On the evidence above they are
-- correct, and rewriting history on a suspicion is not an improvement.
--
-- Needs 0026 applied first, and what enforces that is narrower than it
-- looks: the function lives in `ops`, a schema only 0026 creates, so
-- `create or replace` fails immediately if it is missing. Its body's
-- references — `ops.settle_window()`, the log table, the heartbeat — are
-- not what fails, because plpgsql resolves those at first execution and
-- not at creation. A half-built `ops` would take this file and break at
-- the first sweep instead.
-- =====================================================================

create or replace function ops.sweep_feedback_notifications()
returns integer
language plpgsql
-- Fixed, empty search_path and fully qualified names throughout — the
-- convention 0003 established after the Security Advisor flagged the
-- functions that lacked it.
set search_path = ''
as $function$
declare
  -- Both defined in 0026, as functions rather than literals, because the
  -- view needs the same values and two copies of a window drift. Nothing
  -- is marked lost on `c_settle` alone; see the `not exists` in step 2.
  c_settle    constant interval := ops.settle_window();
  c_retention constant interval := ops.retention_window();

  -- How far after its hook a response may be recorded and still be taken
  -- as that hook's answer.
  --
  -- A constant here rather than a function like the two above, because
  -- only the sweep asks this question — the view never joins to
  -- `net._http_response`. Still defined once: it is used twice below, and
  -- a window with two copies is a window with two values eventually.
  --
  -- The lower bound needs no constant, being exact: a response cannot
  -- predate its own request. This upper bound is a judgement, longer than
  -- any credible `pg_net` backlog and far shorter than any credible gap
  -- between id reuses. Being wrong leaves the row `response_lost`, which
  -- is honest — the cost is silence, not a false answer.
  c_correlation constant interval := interval '24 hours';

  v_written integer;
  v_total   integer := 0;
begin
  -- 1. Archive every delivery whose answer is still in reach.
  insert into ops.feedback_notification_log (
    hook_id, request_id, feedback_id, hook_created_at,
    status_code, timed_out, error_msg, response
  )
  select
    h.id, h.request_id, m.feedback_id, h.created_at,
    r.status_code, r.timed_out, r.error_msg, r.content
  from supabase_functions.hooks h
  -- Correlated by time as well as by id. `net._http_response.id` is
  -- `pg_net`'s request id, and a sequence is only unique within the life of
  -- its extension: drop and recreate `pg_net` and the counter restarts, at
  -- which point a new response can carry the same id as a request made
  -- months ago. `supabase_functions.hooks` is never purged, so those old
  -- request ids are still sitting there waiting to match one.
  --
  -- An id alone would then hand an ancient hook somebody else's outcome —
  -- and the failure lands on the side that matters: a delivery that failed
  -- reported as `delivered`. An alarm that goes quiet is worse than no
  -- alarm, which is the whole argument of 0026.
  --
  -- The bounds themselves are explained at `c_correlation`.
  join net._http_response r
    on r.id = h.request_id
   and r.created >= h.created_at
   and r.created <  h.created_at + c_correlation
  cross join lateral (
    -- How the delivery gets tied back to a feedback row.
    --
    -- `now()` is the transaction timestamp, stable for the whole
    -- transaction. The hooks row is written by an AFTER INSERT trigger,
    -- inside the inserting transaction, and both `hooks.created_at` and
    -- `feedback.created_at` default to `now()` — so they are equal, to
    -- the microsecond. This is an equality join, not a time window.
    --
    -- It is still an inference, and the place it breaks is one
    -- transaction inserting two feedback rows: both stamps are identical
    -- and neither hook can be told from the other. That resolves to null
    -- instead of guessing, because a log that quietly attributes a
    -- failure to the wrong row is worse than one that admits it does not
    -- know. `createFeedback` in `src/lib/db/feedback.ts` inserts one row
    -- per submission, so this is the degenerate case, not the normal one.
    select case when count(*) = 1 then min(f.id) end as feedback_id
    from public.feedback f
    where f.created_at = h.created_at
  ) m
  where h.hook_name = 'feedback_to_telegram'
    -- Past retention is out of scope for the inserts too, not only for
    -- step 3's delete.
    --
    -- Not for correctness: step 3 runs last in the same call, so a row
    -- written here for an ancient hook is deleted again before the sweep
    -- returns, and nothing outside ever sees it. It is the writing that
    -- costs. `supabase_functions.hooks` is never purged by anybody, so
    -- every hook the project has ever fired would be inserted and deleted
    -- again every five minutes, forever, leaving dead tuples for autovacuum
    -- to clear on a table whose whole design argument is that it stays
    -- small. The sweep's return value is what makes this visible: it
    -- counts the write, so the work shows up even though the row does not.
    and h.created_at >= pg_catalog.now() - c_retention
  -- An archived answer is never rewritten: it is evidence, and evidence
  -- that changes under you is not evidence. The one exception is a row
  -- step 2 gave up on. `c_settle` is a heuristic about how long `pg_net`
  -- normally takes, not a promise — a worker backlog or an extension
  -- restart can deliver an answer after the hour is up. With `do nothing`
  -- that answer would hit the conflict and be dropped, leaving a verdict
  -- of "purged" standing forever over a response we are holding in hand.
  -- So a real answer overwrites a guess, and only a guess.
  on conflict (hook_id) do update set
    request_id    = excluded.request_id,
    feedback_id   = excluded.feedback_id,
    status_code   = excluded.status_code,
    timed_out     = excluded.timed_out,
    error_msg     = excluded.error_msg,
    response      = excluded.response,
    response_lost = false,
    swept_at      = pg_catalog.now()
  where ops.feedback_notification_log.response_lost;

  -- Counts new archives and corrections together, and nothing else: a
  -- conflict the `where` above filtered out updates no row and so does
  -- not count. That is what makes this number mean "what the sweep wrote
  -- down" rather than "what the sweep looked at".
  get diagnostics v_written = row_count;
  v_total := v_total + v_written;

  -- 2. Record the deliveries whose answer nobody caught in time.
  --
  -- What is left after step 1 is a hook that has settled with no answer
  -- step 1 would take: purged, never written, never dispatched, or — new
  -- in this migration — recorded outside the correlation window, which is
  -- the id-reuse case the `not exists` below repeats the bound for.
  -- Without this the evidence of a missed sweep is itself missing, which
  -- is the same shape of hole one level up.
  --
  -- `do nothing` here, unlike step 1: this statement only ever writes a
  -- guess, and a guess must never overwrite an answer already on file.
  -- The correction runs the other way round.
  insert into ops.feedback_notification_log (
    hook_id, request_id, feedback_id, hook_created_at, response_lost
  )
  select h.id, h.request_id, m.feedback_id, h.created_at, true
  from supabase_functions.hooks h
  cross join lateral (
    select case when count(*) = 1 then min(f.id) end as feedback_id
    from public.feedback f
    where f.created_at = h.created_at
  ) m
  where h.hook_name = 'feedback_to_telegram'
    and h.created_at >= pg_catalog.now() - c_retention
    and h.created_at < pg_catalog.now() - c_settle
    -- The same correlation as step 1, and for the same reason read the
    -- other way round: an unrelated response sharing this id would make
    -- `exists` true and quietly stop a genuinely lost delivery from ever
    -- being recorded as one.
    and not exists (
      select 1
      from net._http_response r
      where r.id = h.request_id
        and r.created >= h.created_at
        and r.created <  h.created_at + c_correlation
    )
  on conflict (hook_id) do nothing;

  get diagnostics v_written = row_count;
  v_total := v_total + v_written;

  -- 3. Let go of what is past answering. Deliberately not counted in the
  -- return: that number is what the sweep learned, and forgetting is not
  -- learning.
  delete from ops.feedback_notification_log
  where hook_created_at < pg_catalog.now() - c_retention;

  -- 4. Say that this ran. Unconditionally, and last: a sweep that found
  -- nothing is still a sweep that ran, and that is the fact the view needs
  -- in order to read an empty log as "nothing happened" rather than
  -- "nobody looked".
  insert into ops.sweep_heartbeat (only_row, last_run_at)
  values (true, pg_catalog.now())
  on conflict (only_row) do update set last_run_at = excluded.last_run_at;

  return v_total;
end;
$function$;

comment on function ops.sweep_feedback_notifications() is
  'Copies feedback_to_telegram outcomes out of net._http_response before pg_net purges them, correlated by id and time (#288).';
