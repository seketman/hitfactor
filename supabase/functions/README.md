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

**The file is committed exactly as deployed, defects included** — it is a
record, not a proposal. What is wrong with it is written down in issues rather
than fixed here, because a fix that lands in git without a redeploy leaves the
repository describing something that does not exist.

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
# 1. Closed to strangers — must be 401.
curl -i -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://<project-ref>.supabase.co/functions/v1/feedback-telegram \
  -H 'Content-type: application/json' -d '{}'
```

```sql
-- 2. Open to the trigger. Submit feedback from the app, then run this within
-- the hour, while pg_net still holds the response.
select h.created_at, r.status_code, left(r.content, 200) as response
from supabase_functions.hooks h
left join net._http_response r on r.id = h.request_id
where h.hook_name = 'feedback_to_telegram'
order by h.created_at desc
limit 3;
```

`status_code` 200 and the message actually arriving is the pass. Note that the
trigger goes through `pg_net`, which is asynchronous: a failing webhook does
not fail the INSERT, so nothing surfaces in the app when this breaks.
