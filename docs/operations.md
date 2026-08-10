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

### Its limits, which are real

This is the free, zero-dependency option, not the good one:

- **`schedule` is best-effort.** GitHub makes no punctuality promise and
  delays of tens of minutes happen under load. Treat 15 minutes as an upper
  bound on resolution, not a guarantee.
- **It disables itself after 60 days without repository activity.** If
  development pauses, the monitor stops — silently, and exactly when nobody
  is around to notice the site is down either.
- **Alerting is an email on a failed run.** No escalation, no
  acknowledgement, no history beyond the Actions tab.

An external monitor — UptimeRobot or Better Stack, both free at this scale —
has none of those problems and points at the same endpoint. The workflow is
what makes the check exist today; it is not an argument against setting one
up.

## Deliberately out of scope

**Error tracking** (Sentry and friends) is a different axis: it answers "what
broke and where", not "is it up". Bigger commitment, worth its own decision.

**Metrics and dashboards.** A single-maintainer hobby-scale app does not need
an observability stack, and one that is never maintained is worse than
nothing — it produces confident graphs of stale data.
