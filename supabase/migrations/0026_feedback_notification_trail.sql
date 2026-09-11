-- =====================================================================
-- HitFactor — A durable record of what happened to each feedback
-- notification (#288)
-- =====================================================================
-- The feedback -> Telegram path fails silently and permanently. `pg_net`
-- is asynchronous, so a failed webhook does not fail the INSERT: the app
-- tells the user their feedback was submitted, nothing retries, and the
-- only trace of the failure is a row in `net._http_response` that `pg_net`
-- deletes once `pg_net.ttl` elapses. The failure mode is not "a
-- notification was lost" — it is "a notification was lost and the only
-- person who could have noticed had no reason to look", and by the time
-- anybody does look there is nothing left to read.
--
-- 0025 and #286 made that failure *legible*. This makes it *survive*. A
-- scheduled job copies each delivery's outcome out of `net._http_response`
-- before the purge, into `ops.feedback_notification_log`.
--
-- That is all it does. No alert, no retry. Those are directions (2) and
-- (3) of #288 and both need this evidence to work from: there is nothing
-- to alert about and nothing to re-send until the outcome of a delivery
-- outlives the hour in which it happened.
--
-- It outlives it by ninety days and no longer. The sweep drops what is
-- older, which bounds the table and keeps a record of a submission from
-- standing indefinitely after the account behind it is gone. The reasoning
-- is with `c_retention` in `ops.sweep_feedback_notifications()`.
--
-- ---------------------------------------------------------------------
-- Why this touches neither the trigger nor the Edge Function
-- ---------------------------------------------------------------------
-- Linking a delivery to its `feedback.id` *exactly* would mean replacing
-- `supabase_functions.http_request` with a trigger of our own that keeps
-- the `request_id` it returns. That rewrites the live webhook, secret and
-- all — and the header of 0025 spells out what a mis-applied version of
-- that does: 401 forever, nothing visibly broken, which is the very
-- failure this migration exists to catch. Breaking the path in order to
-- watch it is not a trade worth making.
--
-- So this is purely additive. It reads what the existing webhook already
-- writes and changes nothing about it. The cost is that `feedback_id` is
-- inferred rather than recorded; `ops.sweep_feedback_notifications()`
-- explains how, and when it declines to guess.
--
-- ---------------------------------------------------------------------
-- Applying it
-- ---------------------------------------------------------------------
-- Needs `pg_cron`. The migration aborts if it is missing rather than
-- installing a log that nothing ever writes to — an empty table is
-- indistinguishable from a healthy one, and that is the whole class of
-- bug being fixed here.
--
--   Dashboard -> Database -> Extensions -> pg_cron
--
-- It also needs `pg_net`, Database Webhooks, and 0025's
-- `feedback_to_telegram` trigger — the thing whose deliveries this watches.
-- Each is checked by name before anything is created, and each aborts with
-- its own message rather than leaving half a monitor behind.
--
-- Afterwards, verify as `supabase/functions/README.md` describes: submit
-- feedback, wait for one sweep, and read `ops.feedback_delivery_status`.
-- A log that stays empty is not evidence of anything.
--
-- ---------------------------------------------------------------------
-- Backing it out
-- ---------------------------------------------------------------------
-- The job first, the schema second, and in that order:
--
--   select cron.unschedule('sweep-feedback-notifications');
--   drop schema ops cascade;
--
-- Reversed, `pg_cron` is left calling a function that no longer exists
-- and raises every five minutes into `cron.job_run_details` — a log
-- nobody here watches, which is this issue's own failure shape rebuilt
-- out of the cleanup for it.
--
-- Nothing outside `ops` is touched, so there is no other residue.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Preconditions
-- ---------------------------------------------------------------------
-- Checked before anything is created, not after. The view below reads
-- `supabase_functions.hooks` directly, so a missing one fails at DDL time
-- with a bare "relation does not exist" — past the point where half of
-- this migration is already installed, and without saying what to do.
--
-- Every identifier here is schema-qualified, which is what makes the block
-- safe without a `set search_path` of its own: `to_regclass` and
-- `to_regprocedure` consult the search path only to resolve unqualified
-- names, and the `pg_catalog.pg_trigger` read needs no resolution at all,
-- being a qualified table scan against a literal. A `set local` would reach past this statement in a way that
-- depends on whether the file was run inside a transaction, which is worse
-- than the invariant it would protect. Keep the qualifications.
do $preconditions$
begin
  -- The platform's half: `pg_net` and Database Webhooks. Neither table is
  -- created by 0025 — they come with the extensions — so their presence
  -- says nothing about whether the trigger exists. Checked separately
  -- below, because an implication asserted in an error message is not one
  -- the code has established.
  if pg_catalog.to_regclass('supabase_functions.hooks') is null
     or pg_catalog.to_regclass('net._http_response') is null then
    raise exception 'pg_net or Database Webhooks are not enabled.'
      using hint =
        'This migration reads net._http_response and supabase_functions.hooks. '
        'Enable pg_net (Dashboard -> Database -> Extensions) and create at '
        'least one Database Webhook so the supabase_functions schema exists.';
  end if;

  -- 0025's half: the trigger itself, by name, on the table it belongs to.
  -- Testing for the platform tables instead would pass on any project with
  -- a webhook of any kind, install a sweep that matches no hook, and leave
  -- an empty log — which reads exactly like a healthy one, and is the whole
  -- failure this file exists to end.
  if pg_catalog.to_regclass('public.feedback') is null
     or not exists (
       select 1
       from pg_catalog.pg_trigger
       where tgname = 'feedback_to_telegram'
         and tgrelid = pg_catalog.to_regclass('public.feedback')
         -- 'D' is disabled. A trigger that exists but never fires installs
         -- a sweep that matches nothing and leaves an empty log, which is
         -- the same healthy-looking nothing as no trigger at all.
         and tgenabled <> 'D'
     ) then
    raise exception 'The feedback_to_telegram trigger does not exist.'
      using hint =
        'Apply 0025_feedback_telegram_webhook.sql first. There is nothing for '
        'this migration to watch until something is firing that webhook.';
  end if;

  -- The exact function this file calls, not the extension's name. An
  -- extension named `pg_cron` that predates the three-argument `schedule`
  -- — or the `jobname` column read further down — would satisfy a check on
  -- `pg_extension` and then fail halfway through, which is the
  -- half-installed state the rest of this migration works to avoid.
  if pg_catalog.to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'pg_cron is not installed, so the sweep would never run.'
      using hint =
        'Enable it (Dashboard -> Database -> Extensions -> pg_cron) and re-run '
        'this migration. Installing the log without the job that fills it would '
        'leave an empty table that reads exactly like a healthy one.';
  end if;
end
$preconditions$;

-- ---------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------
-- Not `public`, for three reasons that happen to agree. This is operator
-- data, not application data, and nothing in `src/` reads it. `public` is
-- the schema PostgREST exposes, so a table there would need RLS written
-- for an audience that does not exist. And `npm run db:types` generates
-- from `--schema public`, so a table there drifts `database.types.ts`
-- until somebody remembers to regenerate it (#269).
--
-- Making it visible to the app later is an Exposed-Schemas setting plus
-- RLS, and a deliberate decision at that point rather than a side effect
-- of where the table was put today.
create schema if not exists ops;

comment on schema ops is
  'Operator-facing data. Not exposed through PostgREST and not in database.types.ts.';

-- New schemas grant nothing to PUBLIC, so these are assertions rather
-- than changes. They are here because "nobody can reach it" is a claim
-- this file makes, and a claim in a comment is worth less than one the
-- database enforces.
revoke all on schema ops from public;
revoke all on schema ops from anon, authenticated;

-- ---------------------------------------------------------------------
-- The log
-- ---------------------------------------------------------------------
create table if not exists ops.feedback_notification_log (
  -- `supabase_functions.hooks.id`, not the `request_id`. The hooks row is
  -- the durable identity of a delivery attempt: it always exists and it
  -- is never purged. `request_id` is nullable in that table, and the rows
  -- it points at are exactly the ones that disappear.
  hook_id          bigint primary key,
  request_id       bigint,

  -- Deliberately not a foreign key.
  --
  -- `on delete cascade` would delete this row along with the feedback it
  -- describes, which is the failure this table exists to prevent: the one
  -- record that a notification was lost, lost. `on delete set null` keeps
  -- the row and throws away the only thing that makes it mean anything,
  -- and collides with the meaning null already carries below.
  --
  -- So: a plain id. A dangling one reads "the delivery for feedback 42,
  -- which no longer exists", and that is a whole record. Nothing joins on
  -- it for correctness — the only writer is the sweep, which reads the id
  -- out of `public.feedback` in the first place.
  --
  -- Null means the sweep declined to guess which row fired the hook. See
  -- `ops.sweep_feedback_notifications()`, which is also where the row's
  -- lifetime is bounded — the answer to a dangling id outliving the
  -- account that produced it.
  feedback_id      bigint,

  hook_created_at  timestamptz not null,

  -- Copied verbatim from `net._http_response`. These three and `response`
  -- are null together when `response_lost` is true: there was nothing left
  -- to copy.
  status_code      integer,
  timed_out        boolean,
  error_msg        text,

  -- The function's answer, whole. `DIAGNOSIS_BUDGET` in `handler.ts` caps
  -- what the function *writes* and the query in `functions/README.md`
  -- caps what a human *reads*; an archive that also truncated would be a
  -- third number to keep in step, and would make this table lie about
  -- being a copy of what pg_net held.
  response         text,

  -- True when the sweep found a settled hook with no answer to copy. Two
  -- causes reach it and the view tells them apart by `request_id`:
  -- `pg_net` purged the answer before a sweep read it, or there was never
  -- a request to answer (`request_id` null — `net.http_post` returned
  -- nothing, so the call was never dispatched at all).
  --
  -- Either way it is worth a row, because "no record" and "a record that
  -- says we looked too late" are different facts. Not permanent: an
  -- answer that turns up afterwards overwrites this, see the sweep.
  response_lost    boolean not null default false,

  swept_at         timestamptz not null default now()
);

comment on table ops.feedback_notification_log is
  'One row per feedback_to_telegram delivery attempt, outliving net._http_response (#288).';

-- ---------------------------------------------------------------------
-- The heartbeat
-- ---------------------------------------------------------------------
-- One row, holding when the sweep last finished.
--
-- Everything else here reasons about a delivery from the *absence* of a
-- record, and absence has two causes that look identical: nothing happened,
-- or nothing was watching. Without this, a sweep that stopped months ago
-- reports every delivery it missed as though it had judged them — and past
-- the retention window it reports them as "not a fault", which is the #272
-- silence rebuilt inside the thing built to end it.
--
-- A monitor that cannot say whether it is running is not a monitor. So it
-- says so, and the view asks before concluding anything from an empty log.
create table if not exists ops.sweep_heartbeat (
  -- Single row by construction: the only value the primary key accepts is
  -- `true`, so a second insert conflicts with the first instead of quietly
  -- creating a rival heartbeat.
  only_row    boolean primary key default true check (only_row),
  last_run_at timestamptz not null
);

comment on table ops.sweep_heartbeat is
  'When the sweep last finished. Lets the view tell "nothing happened" from "nothing was watching" (#288).';

create index if not exists feedback_notification_log_feedback_idx
  on ops.feedback_notification_log (feedback_id);

create index if not exists feedback_notification_log_recent_idx
  on ops.feedback_notification_log (hook_created_at desc);

-- ---------------------------------------------------------------------
-- The settle window
-- ---------------------------------------------------------------------
-- How long after a hook fires its answer is still considered in flight.
-- The trigger's own budget is 5000 ms and the function answers inside 3000
-- (`TELEGRAM_TIMEOUT_MS`), so an hour is not a guess about `pg_net.ttl` —
-- it is a window wide enough that anything still unanswered is genuinely
-- unanswered.
--
-- A function rather than a literal because the sweep and the view both need
-- it and must agree. They were two independent `interval '1 hour'`s, held
-- in step by a comment; moving one and not the other would have made a
-- settled delivery read as `pending`, or an unsettled one as
-- `NO DELIVERY ATTEMPTED` — the false-negative this file exists to prevent,
-- rebuilt out of its own constant.
create or replace function ops.settle_window()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '1 hour' $$;

comment on function ops.settle_window() is
  'The one settle window, shared by the sweep and the view (#288).';

-- ---------------------------------------------------------------------
-- The retention window
-- ---------------------------------------------------------------------
-- How long a delivery record is kept.
--
-- Two reviews of this file disagreed, both correctly. Dropping the row when
-- its feedback is deleted destroys the evidence that a notification was
-- lost — the failure this table exists to prevent. Keeping it forever
-- leaves a record of a submission, and of the account that made it,
-- standing after an erasure request has removed both.
--
-- Retention is the answer to that pair, and it is the ordinary one: an
-- audit trail is not deleted on request, it is bounded. Ninety days is
-- sized to the question this table answers — "has the webhook been working
-- lately" — against the evidence recorded in #288 that #272 went two months
-- unnoticed. Past that window a row answers nothing anybody is still
-- asking, and is only a liability.
--
-- It also bounds the table, which nothing else does: `pg_net` purges
-- `net._http_response` on `pg_net.ttl`, and Supabase never purges
-- `supabase_functions.hooks` at all.
--
-- Shared with the view for the same reason as the settle window: the view
-- has to know when a missing record is retention doing its job rather than
-- something to raise the alarm about.
create or replace function ops.retention_window()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '90 days' $$;

comment on function ops.retention_window() is
  'How long a delivery record is kept. Shared by the sweep and the view (#288).';

-- ---------------------------------------------------------------------
-- The sweep's cadence
-- ---------------------------------------------------------------------
-- How often the job runs. It must match the schedule at the foot of this
-- file (`*/5 * * * *`) — that literal is a string `pg_cron` parses and
-- cannot be derived from here, so it is the one number to keep in step.
--
-- Two different questions are answered from it, and they want different
-- multiples of it rather than one shared slack:
--
--   * Is the sweep alive? Six missed runs. Generous, because a restart or
--     a slow minute must not raise an alarm.
--   * Has the sweep had its chance at this row? Two runs. Tight, because
--     the sweep takes a settled row on the very next tick — it has no grace
--     period of its own — so anything still unrecorded after two is not
--     waiting, it is stuck.
--
-- Do not collapse them back into one constant. Thirty minutes is the right
-- answer to the first question and much too generous for the second: a
-- genuinely stuck row then reads as `pending` for an extra twenty-five
-- minutes, blunting the one branch that exists to notice it.
create or replace function ops.sweep_interval()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '5 minutes' $$;

comment on function ops.sweep_interval() is
  'The sweep''s cron cadence. Keep in step with the schedule at the foot of 0026 (#288).';

-- ---------------------------------------------------------------------
-- The sweep
-- ---------------------------------------------------------------------
create or replace function ops.sweep_feedback_notifications()
returns integer
language plpgsql
-- Fixed, empty search_path and fully qualified names throughout — the
-- convention 0003 established after the Security Advisor flagged the
-- functions that lacked it.
set search_path = ''
as $function$
declare
  -- Defined once, above, because the view needs the same value. Nothing
  -- is marked lost on the strength of it alone; see the `not exists` in
  -- step 2.
  c_settle constant interval := ops.settle_window();

  -- Defined once, above, because the view needs the same value.
  c_retention constant interval := ops.retention_window();

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
  join net._http_response r on r.id = h.request_id
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
  -- What is left after step 1 is a hook that has settled and has no
  -- response row at all — purged, never written, or never dispatched.
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
    and not exists (
      select 1 from net._http_response r where r.id = h.request_id
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
  'Copies feedback_to_telegram outcomes out of net._http_response before pg_net purges them (#288).';

-- ---------------------------------------------------------------------
-- The view a human actually opens
-- ---------------------------------------------------------------------
-- The log answers "what happened to this delivery". The question worth
-- asking is the other one: "is there feedback nobody was told about".
-- Those differ exactly where it matters — a feedback row that fired no
-- hook at all has no log row to inspect, and that is the #272 failure.
create or replace view ops.feedback_delivery_status
  with (security_invoker = on) as
select
  f.id         as feedback_id,
  f.created_at,
  f.type,
  l.hook_id,
  l.status_code,
  l.timed_out,
  l.error_msg,
  l.response,
  (select b.last_run_at from ops.sweep_heartbeat b) as sweep_last_run_at,
  -- Ordered most specific first. Every branch is a distinct fact about
  -- the delivery, and the ones that merely say "we do not know" come last
  -- so they never swallow one that does know.
  case
    when l.status_code = 200       then 'delivered'

    -- No `pg_net` request id on the hook row: `net.http_post` returned
    -- nothing, so the call was never dispatched. `response_lost` is true
    -- for these too, but "purged" would be the wrong word — nothing was
    -- ever sent, which is a worse fact and a different repair.
    when l.hook_id is not null
     and l.request_id is null      then 'failed: never dispatched, no pg_net request id'

    when l.response_lost           then 'unknown: the answer was purged before a sweep read it'
    when l.timed_out               then 'failed: pg_net gave up before the function answered'
    when l.status_code is not null then 'failed: HTTP ' || l.status_code::text

    -- `pg_net` records connection-level failures — DNS, refused, TLS — in
    -- `error_msg` alone, with no status code and `timed_out` false. Left
    -- out, those fall through to "outcome not recorded" while the reason
    -- sits in the very next column of the row being read.
    when l.error_msg is not null   then 'failed: ' || l.error_msg

    when l.hook_id is not null     then 'unknown: attempt recorded, outcome not'

    -- Before `pending`, not after. A delivery the sweep could not
    -- attribute has no row on the join above, so this feedback looks
    -- exactly like one nothing has swept yet — and for the first hour
    -- `pending` would answer first and hide it, which is the one lie this
    -- view must not tell. The sweep runs every five minutes; the ambiguity
    -- is already on record by the time anybody reads this.
    when exists (
      select 1
      from ops.feedback_notification_log u
      where u.feedback_id is null
        and u.hook_created_at = f.created_at
    )                              then 'unknown: a delivery at this timestamp could not be attributed'

    -- Everything above read a record the sweep wrote. Below, no record
    -- exists, and the branches are ordered by what can still be decided
    -- without one — most decidable first.

    -- Decidable immediately, and independent of the sweep entirely. The
    -- hook row is written by the trigger inside the transaction that
    -- inserts the feedback, so "no hook at this timestamp" is true the
    -- moment the feedback exists: nothing to wait for, nothing to archive.
    --
    -- It comes before the heartbeat on purpose. A dead sweep and a dropped
    -- trigger can happen at once, and restarting `pg_cron` does not fix the
    -- second; reporting only the sweep would hide the alarm that is both
    -- more specific and still provable.
    --
    -- `exists` rather than the `count(*) = 1` guard the sweep uses: the
    -- question is whether *a* delivery fired at this timestamp, not which
    -- row it belonged to, and two feedback rows sharing a stamp both fired
    -- one. Ambiguity cannot make this answer wrong.
    when not exists (
      select 1
      from supabase_functions.hooks h
      where h.hook_name = 'feedback_to_telegram'
        and h.created_at = f.created_at
    )                              then 'NO DELIVERY ATTEMPTED'

    -- From here a delivery definitely fired and nothing is on file for it.

    -- Past the horizon, where by construction nothing is on file and
    -- nothing can be. It does not claim the record was kept once and then
    -- expired: it cannot tell that from a delivery this sweep was never
    -- alive to archive, and an earlier version of this branch said "not a
    -- fault" about both. Retention means questions this old have no
    -- answer — if they need one, the window is the thing to change.
    when f.created_at < pg_catalog.now() - ops.retention_window()
                                   then 'past retention: a delivery fired; no record is kept this far back'

    -- Within the window and still nothing recorded, so the question is
    -- whether anything was watching at all. `sweep_last_run_at` in this view
    -- says since when.
    --
    -- The label is a constant on purpose: the timestamp belongs in its own
    -- column, not glued into a value the README enumerates and the tests
    -- match exactly.
    when not exists (
      select 1
      from ops.sweep_heartbeat b
      where b.last_run_at > pg_catalog.now() - 6 * ops.sweep_interval()
    )                              then 'unknown: the sweep is not running — see sweep_last_run_at'

    -- The sweep is alive and has not had its chance at this one yet. Two
    -- ticks, not the six the liveness check allows: a row crossing the
    -- settle boundary really is unarchived until the next run, so some
    -- slack is needed — but the sweep takes it on that next run, so more
    -- slack than that only delays noticing a row that is stuck.
    when f.created_at > pg_catalog.now()
                        - (ops.settle_window() + 2 * ops.sweep_interval())
                                   then 'pending: not swept yet'

    -- Alive, given its chance, and still nothing written down. No known
    -- cause — which is why it says so, rather than picking one of the
    -- explanations already ruled out above.
    else                                'unknown: the sweep is running but this delivery was never archived'
  end as delivery
from public.feedback f
left join ops.feedback_notification_log l on l.feedback_id = f.id;

comment on view ops.feedback_delivery_status is
  'Feedback rows with the fate of their Telegram notification. Read this, not the log (#288).';

-- ---------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------
do $migration$
begin
  -- The exact function this file calls, not the extension's name. An
  -- extension named `pg_cron` that predates the three-argument
  -- `schedule` — or the `jobname` column read below — would satisfy a
  -- check on `pg_extension` and then fail halfway through, which is the
  -- half-installed state the rest of this migration works to avoid.
  -- Every five minutes. The cost is two indexed reads over tables holding
  -- single-digit row counts; the benefit is that the window in which a
  -- stopped cron can lose an outcome stays far inside `pg_net.ttl`,
  -- whatever the platform has that set to.
  if exists (
    select 1 from cron.job where jobname = 'sweep-feedback-notifications'
  ) then
    perform cron.unschedule('sweep-feedback-notifications');
  end if;

  perform cron.schedule(
    'sweep-feedback-notifications',
    '*/5 * * * *',
    $job$select ops.sweep_feedback_notifications()$job$
  );

  -- Backfill whatever pg_net still holds, so applying this does not start
  -- by throwing away the one window that is open right now.
  perform ops.sweep_feedback_notifications();

  raise notice
    'Sweep scheduled. Verify it the way functions/README.md says: submit feedback, wait a sweep, read ops.feedback_delivery_status. An empty log proves nothing.';
end
$migration$;
