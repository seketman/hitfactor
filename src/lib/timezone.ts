import { headers } from "next/headers";

/**
 * Resolves the time zone to render timestamps in (#190).
 *
 * Until this existed, `formatDateTime` rendered in the *process* time zone,
 * which on Vercel is UTC — an Argentinian shooter saw every timestamp three
 * hours ahead. The instant stored in the DB was always right (every
 * timestamp column is `timestamptz`, so Postgres keeps an absolute instant);
 * only the rendering side was wrong.
 *
 * Vercel's edge already resolves the visitor's time zone from their IP and
 * forwards it as `x-vercel-ip-timezone`, in IANA name format
 * (`America/Argentina/Buenos_Aires`). That is available on the very first
 * request, server-side, so the fix needs no cookie, no client component and
 * no second render — which also means no hydration mismatch and no flash of
 * the wrong time.
 *
 * **This lives outside `lib/utils.ts` on purpose.** It imports
 * `next/headers`, which is server-only; `utils.ts` is imported by client
 * components too, and pulling this in there would break them.
 *
 * Deliberately IP-based and therefore approximate: someone on a VPN, or
 * travelling, gets the time zone of wherever they appear to be rather than
 * the one they think in. Fixing that properly needs the time zone stored on
 * the profile, which is its own issue — when it lands it takes precedence
 * over this, and nothing here has to change.
 */

/** Header set by Vercel's edge. Absent anywhere else, including `next dev`. */
const VERCEL_TIME_ZONE_HEADER = "x-vercel-ip-timezone";

/**
 * Used when the header is missing (local dev, self-hosting, a crawler that
 * the edge could not geolocate) or carries something that is not a time
 * zone.
 *
 * UTC and not a guessed local zone: the analytics for this app split roughly
 * evenly between Argentina and the United States, so there is no majority to
 * default to, and a wrong guess is worse than an honest one. UTC is at least
 * unambiguous.
 */
export const FALLBACK_TIME_ZONE = "UTC";

/**
 * `Intl.DateTimeFormat` throws `RangeError` on a time zone it does not know,
 * and there is no non-throwing way to ask. Constructing one and catching is
 * the check.
 *
 * Two reasons this matters. Rendering one is that an unvalidated value would
 * turn a bad header into a 500 on a page that is otherwise fine. The other
 * is that `formatDateTime` memoises a formatter per (locale, time zone)
 * pair: without this, arbitrary header values would each add an entry and
 * the cache would grow unbounded. Validated IANA names cap it at the few
 * hundred zones that actually exist.
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The visitor's time zone, or {@link FALLBACK_TIME_ZONE}.
 *
 * Reading `headers()` opts the caller into dynamic rendering, so call this
 * only from routes that are already dynamic. Every current call site is
 * under `(app)`, behind auth, and therefore already was. Putting this in
 * `i18n/request.ts` instead would have applied it to the whole app — landing
 * page and SEO routes included — and made all of them dynamic to fix three
 * timestamps.
 */
export async function getRequestTimeZone(): Promise<string> {
  const timeZone = (await headers()).get(VERCEL_TIME_ZONE_HEADER);
  if (timeZone && isValidTimeZone(timeZone)) return timeZone;
  return FALLBACK_TIME_ZONE;
}
