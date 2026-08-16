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
only place a failure of this path is ever visible.
