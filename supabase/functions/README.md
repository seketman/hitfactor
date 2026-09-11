# Edge Functions

Deno functions that run on Supabase, outside the Next.js app. They are
deployed separately from Vercel, so **committing one does not deploy it** —
these files exist to be the source of truth for what is running, and to
survive a project being rebuilt from the migrations.

They arrived here late: `feedback-telegram` ran in production for two months
before anyone noticed it was not in the repository. If you change one, deploy
it in the same change, or the file starts lying.

## `feedback-telegram`

Posts a Telegram message when someone submits feedback. Fired by the
`feedback_to_telegram` trigger on `public.feedback`
(`supabase/migrations/0025_feedback_telegram_webhook.sql`), which sends the new
row to this function.

**The file is committed exactly as deployed** — it is a record, not a
proposal. It arrived here with its defects intact, written down in #272 rather
than fixed on the spot, because a fix that lands in git without a redeploy
leaves the repository describing something that does not exist. That has not
changed: a commit touching this directory is only half the work until the
function is redeployed.

### Why it is three files

`index.ts` is the entrypoint and nothing else — it hands `Deno.env.get` and
`fetch` to `handleRequest`. Everything else lives in `handler.ts` (the webhook)
and `format.ts` (the Telegram message), both plain TypeScript that vitest
imports and drives directly, in `tests/feedback-telegram-handler.test.ts` and
`tests/feedback-telegram-message.test.ts`.

The shape is the lesson of #272. ESLint ignores this directory for being Deno,
and vitest cannot import a module that calls `Deno.serve` on load, so whatever
sits in `index.ts` ships on the strength of somebody having read it — which is
how a `parse_mode: "Markdown"` with the user's text beside it survived to
production. (`handler.ts` and `format.ts` escape that: `tsconfig.json` lists
this directory under `exclude`, but `exclude` only decides which files are
roots, and tsc follows the tests' imports into both. `index.ts` is the one file
nothing type-checked imports.)

Covering it by scanning that source as text was tried first and did not work: a
substring is not a scope, and review walked several regressions straight through
it. The header of `tests/feedback-telegram-handler.test.ts` lists which ones.
Injecting the two capabilities instead makes the whole webhook ordinary testable
code.

**So: anything you would want to assert about goes in `handler.ts` or
`format.ts`. Code added to `index.ts` is code nothing will check again.**

### Secrets

Set under *Dashboard → Edge Functions → feedback-telegram → Secrets*. None of
them belong in this repository:

| Name | What it is |
|---|---|
| `TELEGRAM_BOT_TOKEN` | the bot that sends the message |
| `TELEGRAM_CHAT_ID` | where it sends it |
| `FEEDBACK_WEBHOOK_SECRET` | shared with the trigger; the only thing keeping the endpoint closed |

That last one matters more than it looks. The function is deployed with
`verify_jwt` off, so `FEEDBACK_WEBHOOK_SECRET` is what stands between the
endpoint and the open internet — enabling `verify_jwt` would *not* replace it,
since the anon key that would satisfy it ships in the browser bundle.

### Checking it after any change

Both halves, always. One passing on its own proves nothing: a function that
rejects everything looks identical to a healthy one until the day you need the
notification.

```bash
# 1. Closed to strangers — must be 401, whatever the body. The secret is
#    checked before the body is read, so garbage gets the same answer as
#    well-formed JSON; if either line prints anything else, stop.
for body in '{}' 'not json'; do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST \
    https://<project-ref>.supabase.co/functions/v1/feedback-telegram \
    -H 'Content-type: application/json' -d "$body"
done
```

```sql
-- 2. Open to the trigger. Submit feedback from the app, then run this within
-- the hour, while pg_net still holds the response. Put a `_`, a `*` and an `&`
-- in the text: those are the characters that used to drop the notification,
-- and a message without them exercises the easy half only.
select h.created_at, r.status_code, r.timed_out, r.error_msg,
       left(r.content, 400) as response
from supabase_functions.hooks h
left join net._http_response r on r.id = h.request_id
where h.hook_name = 'feedback_to_telegram'
order by h.created_at desc
limit 3;
```

`timed_out` and `error_msg` are there because `status_code` and `content` are
both null when pg_net gives up before the function answers — without those two
columns that row reads as though nothing happened. 400 rather than 200 because
the function keeps `DIAGNOSIS_BUDGET` characters of the explanation — 250 — and
the JSON around it spends the rest. Move one of those numbers and move the
other.

`status_code` 200 and the message actually arriving is the pass. Note that the
trigger goes through `pg_net`, which is asynchronous: a failing webhook does
not fail the INSERT, so nothing surfaces in the app when this breaks.

When it is not 200, `response` says why in words — a missing secret by name, or
Telegram's own description of what it rejected. That is deliberate: this is the
first place a failure of this path becomes visible.

### After the hour: `ops.feedback_delivery_status`

The query above reads `net._http_response`, which `pg_net` purges on its own
schedule. It answers for somebody who is already looking — right after a
deploy, a rotation, or a migration. It cannot answer for the case that actually
costs something: nobody suspected anything, so nobody looked, and now there is
nothing left to look at.

`0026_feedback_notification_trail.sql` closes that. A `pg_cron` job copies each
delivery's outcome into `ops.feedback_notification_log` every five minutes, and
this view puts it next to the feedback it belongs to:

```sql
select * from ops.feedback_delivery_status
order by created_at desc
limit 20;
```

`delivery` is the column to read. `delivered` is the only good answer:

| `delivery` | What it means |
|---|---|
| `delivered` | Telegram accepted it. |
| `failed: HTTP …` | The function answered and said no. `response` has the reason in words. |
| `failed: pg_net gave up…` | The call outran the trigger's 5000 ms. Nothing reached Telegram. |
| `failed: …` (anything else) | A connection-level failure — DNS, refused, TLS — as `pg_net` recorded it in `error_msg`. |
| `failed: never dispatched…` | The hook has no `pg_net` request id. The call was never made at all, which is worse than a call that failed. |
| `unknown: the answer was purged…` | The sweep came back, but too late: `pg_net` had already dropped the result. The delivery happened; its outcome is gone. |
| `unknown: attempt recorded, outcome not` | `pg_net` answered with no status, no timeout and no error. Not expected; investigate the row. |
| `unknown: a delivery at this timestamp…` | Two feedback rows went in on one transaction, so the sweep would not guess which is which. Rare, and not a failure. |
| `pending: not swept yet` | The sweep is alive and has not had its chance yet — under 70 minutes old (settle window plus two runs). Wait. |
| `unknown: the sweep is not running…` | **Nothing is watching.** No sweep in the last 30 minutes. `sweep_last_run_at` says since when; check `cron.job` and `cron.job_run_details`. |
| `unknown: the sweep is running but…` | The sweep is alive and this one still went unarchived. No known cause — read the row. |
| `past retention: a delivery fired…` | Older than 90 days. Nothing is kept that far back, by design. Not an answer, and not an alarm. |
| `NO DELIVERY ATTEMPTED` | **The trigger never fired.** Dropped, disabled, or never installed — the #272 shape. Known the instant the feedback exists, and reported even while the sweep is down. |

The bottom five are all read out of an *absence* — no log row — and they are
evaluated in this order, most decidable first. The order is the contract, not
an accident:

1. **`NO DELIVERY ATTEMPTED`** needs nothing else. The trigger writes its
   `supabase_functions.hooks` row inside the transaction that inserts the
   feedback, so a missing hook is settled the instant the feedback exists — no
   waiting, and no dependence on the sweep. That last part matters: a dead cron
   and a dropped trigger can happen together, and restarting `pg_cron` fixes
   only one of them.
2. **`past retention`** comes next, and claims the least of any answer here. It
   does *not* say the record was kept and then expired — it cannot tell that
   from a delivery the sweep was never alive to archive, and an earlier version
   of this view called both of them "not a fault". Past the horizon there is no
   record either way. If that needs an answer, the window is the thing to
   change, and it has to answer before the heartbeat for exactly this reason.
3. **`unknown: the sweep is not running`** — inside the window, nothing
   recorded, and `ops.sweep_heartbeat` has not been stamped in six runs
   (30 minutes at the `*/5` cadence). Generous on purpose: a restart must not
   raise an alarm. `sweep_last_run_at` says since when.
4. **`pending: not swept yet`** — the sweep is alive and has not had its chance
   yet: the settle window plus *two* runs, not the six above. A row crossing
   the settle boundary really is unarchived until the next tick, so it needs
   some slack — but the sweep takes it on that next tick, with no grace period
   of its own, so any more slack than that only delays noticing a row that is
   genuinely stuck.
5. **`unknown: the sweep is running but…`** — alive, given its chance, and
   still nothing written down. No known cause, which is why it says so instead
   of borrowing one of the explanations already ruled out above.

**Retention is 90 days.** The sweep drops log rows older than that — long
enough to answer "has this been working lately" against a break that went two
months unnoticed (#272, recorded in #288), short enough that a delivery record
does not outlive the account that produced it by years. Nothing else bounds
this table.

`supabase_functions.hooks` is *not* bounded — nothing purges it, ever. That is
why `NO DELIVERY ATTEMPTED` keeps its meaning at any age: the log expires, the
evidence that a hook fired does not. An outage from last year still reads as an
outage rather than aging into `past retention`.

Two things it deliberately does not do. It does not alert: reading it is still
something a person has to choose to do, and turning that into a notification
is directions (2) and (3) of #288. And it does not retry — a row saying
`failed` is evidence, not a queue.

Every one of those values is asserted in `tests/feedback-notification-trail.test.ts`,
which applies the migration verbatim to a real Postgres compiled to wasm. What
it cannot check is the platform underneath: `net`, `supabase_functions` and
`cron` are stubbed from their published definitions, so the two-part manual
check above is still the only thing that proves this webhook works end to end.

`feedback_id` is inferred, not recorded: the sweep matches a delivery to the
row that fired it by transaction timestamp, which is exact for one insert per
transaction and declines to guess otherwise. Recording it properly would mean
replacing the trigger, and the migration's header explains why that trade is a
bad one.
