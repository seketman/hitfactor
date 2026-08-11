# Operations

Knowing whether the site is up, and finding out when it is not.

## Why there is anything here at all

On **2026-08-07** the app served a general error for some minutes and then
recovered on its own. It was noticed only because the maintainer happened to
refresh at that moment while changing an unrelated Supabase setting.

Nobody could say afterwards whether it had lasted thirty seconds or twenty
minutes, because nothing was sampling. Two causes were plausible — a network
restriction change and a Postgres upgrade running around the same time — and
they could not be separated, because there was no timestamped record of when
the failures started or stopped. The incident was diagnosed by deduction:
*it recovered without anyone changing anything back, so a firewall rule was
not the cause.*

That reasoning was sound and it should not have been necessary.

## Why Vercel's own alerting does not cover it

Worth stating plainly, because "Vercel already watches this" is the obvious
assumption and it is wrong.

Vercel's alerts are **anomalies in the error rate**. Its own reference table
puts the threshold for sparse traffic at ~51 errors, or 5 across two
consecutive five-minute windows. This app sees a handful of visitors a day.

An outage at 4am produces **zero requests, and therefore zero errors**. There
is no anomaly, so there is nothing to fire on. Error-rate alerting can only
see failures that somebody was there to receive — it is a good tool for "are
users hitting errors" and structurally the wrong one for "is the site up".

A probe answers the question by *generating* the traffic. That is the whole
point of it.

## `GET /api/health`

Public, unauthenticated, uncached.

| Response | Meaning |
|---|---|
| `200` `{"status":"ok","checks":{"database":true}}` | App renders and the database answers |
| `503` `{"status":"degraded","checks":{"database":false}}` | The data layer did not answer |

Point any monitor at it and alert on non-`200`.

**Why not just check `/es/login`.** That page is public and cheap, but it
renders perfectly well with PostgREST down. It detects "the app is gone" and
misses "the data layer is gone" — which is the half that actually broke.

**What it asserts.** That the data layer *answers*, not that it returns data.
The probe is anonymous and the table it touches is readable `to
authenticated`, so RLS filters every row and the result is empty. That is the
normal healthy case: an empty result still proves the request reached
PostgREST, that Postgres ran the policy, and that the connection is alive. A
dropped table, revoked key, paused project or unreachable database all
produce an error instead.

**What it does not say.** Only a status and one boolean per check — no error
text, no versions, no timings. It is unauthenticated, so anything it returns
it returns to everyone. Failure reasons go to the Vercel function log, where
the operator can read them and nobody else can.

## The bundled workflow

`.github/workflows/uptime.yml` polls the endpoint every 15 minutes and fails
the run when it does not answer `200`, which triggers GitHub's usual
notification.

It needs the target URL, which is deliberately not in the repository — the
production domain lives in `NEXT_PUBLIC_SITE_URL` on Vercel:

```bash
gh variable set HEALTHCHECK_URL --body "https://<domain>/api/health"
```

Without it the workflow fails immediately with that instruction, rather than
guessing a host and reporting green about something nobody asked it to watch.

### Where the alert has to land

Configured in your **account** notification settings, not the repository's:
[github.com/settings/notifications](https://github.com/settings/notifications)
→ **System → Actions** → `on GitHub, Email. (Failed workflows only)`.

The "failed only" part matters. Without it every green run mails you, and a
channel that is 99% noise stops being read — which costs you the one message
that was worth reading.

**Check that the email actually reaches somewhere you look.** It arrives from
`notifications@github.com` with the subject `Run failed: Uptime - main (…)`.
A mail rule that files GitHub notifications into a folder will catch it too,
and an alert delivered to a folder nobody opens is the same as no alert. That
is not hypothetical: it happened here, and it cost forty minutes of believing
the monitor was broken when it had worked correctly twice.

Keeping **on GitHub** enabled alongside email is worth it for that reason.
Two delivery paths, and the second one does not depend on what a mail
provider decides about a sender it has never seen before.

### Its limits, which are real

This is the free, zero-dependency option, not the good one:

- **`schedule` is best-effort, and the gap is much wider than configured.**
  The cron says every 15 minutes. Measured over a day of real runs, the
  actual gaps were 55, 50, 96 and 70 minutes. **Treat the real resolution as
  about an hour**, which means a 40-minute outage can pass unseen. This is
  GitHub's documented behaviour under load, not a misconfiguration, and
  tightening the cron does not fix it.
- **It disables itself after 60 days without repository activity.** If
  development pauses, the monitor stops — silently, and exactly when nobody
  is around to notice the site is down either.
- **Alerting is a notification on a failed run.** No escalation, no
  acknowledgement, no history beyond the Actions tab. Nothing tells you the
  site came back either: you get the failure and then silence, so recovery
  has to be checked by hand.

An external monitor — UptimeRobot or Better Stack, both free at this scale —
has none of those problems and points at the same endpoint. The workflow is
what makes the check exist today; it is not an argument against setting one
up.

## Testing that the alert alerts

A monitor nobody has watched fire is a monitor being trusted on faith, and
the failure path is the half that never runs in normal operation. Exercise it
after any change to the workflow, the endpoint, or the notification settings:

```bash
# 1. Aim it at something that cannot answer 200
gh variable set HEALTHCHECK_URL --body "https://<domain>/api/does-not-exist"

# 2. Fire it by hand (this is what `workflow_dispatch` is in the file for)
gh workflow run uptime.yml

# 3. Confirm it failed, and that the notification arrived
gh run list --workflow=uptime.yml --limit 1
gh api /notifications --jq '.[] | select(.subject.type=="CheckSuite") | .subject.title'

# 4. Put it back, and confirm it goes green again
gh variable set HEALTHCHECK_URL --body "https://<domain>/api/health"
gh workflow run uptime.yml
```

Step 4 is not optional. Leaving the variable pointed at a broken URL turns
the monitor into a permanent false alarm, which is worse than having none:
the next real failure looks exactly like the noise you have started ignoring.

Both times this was run, the whole chain worked and the exercise still paid
for itself — once by showing the probe dumped 4KB of HTML into the log on
failure, once by showing the email was being filed away unread.

## Deliberately out of scope

**Error tracking** (Sentry and friends) is a different axis: it answers "what
broke and where", not "is it up". Bigger commitment, worth its own decision.

**Metrics and dashboards.** A single-maintainer hobby-scale app does not need
an observability stack, and one that is never maintained is worse than
nothing — it produces confident graphs of stale data.
