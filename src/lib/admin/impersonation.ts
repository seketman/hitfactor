import type { TypedSupabaseClient } from "../supabase/types";
import type { Profile, Shooter } from "../db/types";
import { getProfile } from "../db/profiles";
import { listMyShooters } from "../db/shooters";
import { AUDIT_ACTION, logAction } from "../audit/log-action";

/**
 * Admin override: view the dashboard as another user (`?asProfile=<uuid>`).
 *
 * An admin loads another user's profile plus **all** of their linked
 * shooters, and the dashboard renders their KPIs, history, statistics and
 * ammunition usage. It exists for diagnosing "my numbers look wrong"
 * reports without asking for the account's password.
 *
 * **The session never changes.** The admin stays themselves: any write —
 * claim, import, firearm — is attributed to the admin, not to the person
 * being viewed. Only reads are redirected.
 *
 * The failure mode is deliberate: an override requested by a non-admin, or
 * naming a profile that does not exist, resolves to "not impersonating"
 * rather than to an error. The URL is user input, and a 403 would confirm
 * which UUIDs are real to anyone who guesses one.
 *
 * That is also why the UUID shape is checked before the lookup. `getProfile`
 * runs its result through `unwrap`, which **throws**, and Postgres rejects a
 * malformed uuid rather than returning no rows — so `?asProfile=whatever`
 * used to answer with a 500 instead of the silent fallback described above.
 *
 * ## Why this is audited (#208)
 *
 * Reading someone's entire competitive history is the most sensitive thing
 * this app lets one account do to another, and it was the only such action
 * leaving no trace — in a codebase that records a `min_shots` edit with
 * `before`/`after` snapshots. The gate itself works; what was missing was
 * the record that it had been passed.
 *
 * The principle is already stated on `toggleEntryAbsent`: allowing an
 * action opens the possibility of *silent* abuse, so the answer is to make
 * it not silent. That argument is stronger here, because impersonation
 * leaves nothing behind in the data for anyone to notice later.
 *
 * ## One row per request, on purpose
 *
 * This logs every resolution, not once per "session" of impersonation.
 * Browsing four discipline tabs while impersonating writes four rows.
 *
 * That is the intent rather than an oversight. Each render really is
 * another read of that person's data, and the scope of each one is
 * recorded, so the log answers "what did the admin look at" and not only
 * "did they start looking". Collapsing repeats behind a time window would
 * make the log tidier by hiding accesses that genuinely happened, which is
 * the wrong trade for the one action in the app that has no other trace.
 */

export interface ImpersonationResult {
  /** The impersonated profile, or `null` when not impersonating. */
  profile: Profile | null;
  /** Their linked shooters. Empty when not impersonating. */
  shooters: Shooter[];
}

/**
 * A fresh object per call rather than a shared constant: the result holds
 * an array, and one caller mutating it would corrupt every later "not
 * impersonating" answer in the process.
 */
function notImpersonating(): ImpersonationResult {
  return { profile: null, shooters: [] };
}

/**
 * `asProfile` is a query-string value on its way to a `uuid` column.
 * Postgres rejects a malformed one with an error rather than an empty
 * result, and `getProfile` turns that into a thrown `Error`, so without
 * this a junk value is a 500 instead of the documented silent fallback.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the admin was looking at, recorded alongside the access. */
export interface ImpersonationScope {
  /** Active discipline, or `null` on the consolidated dashboard. */
  disciplineCode?: string | null;
  /** Active division filter, if any. */
  divisionCode?: string | null;
}

/**
 * Resolves `?asProfile`, and records the access when it succeeds.
 *
 * The gate, the load and the audit entry live together so that a future
 * caller cannot pick up the capability and forget the record — which is
 * exactly how it came to be unaudited in the first place.
 *
 * Auditing is best-effort inside `logAction`: a failed insert warns and
 * does not throw. That is the right call for a user action that must not
 * break over its own bookkeeping, and it is worth being explicit that it
 * makes the log *best-effort*, not guaranteed.
 */
export async function resolveImpersonation(
  supabase: TypedSupabaseClient,
  viewer: { id: string; isAdmin: boolean },
  asProfile: string | null | undefined,
  scope: ImpersonationScope = {},
): Promise<ImpersonationResult> {
  if (!viewer.isAdmin || !asProfile) return notImpersonating();
  if (!UUID_RE.test(asProfile)) return notImpersonating();

  const [profile, shooters] = await Promise.all([
    getProfile(supabase, asProfile),
    listMyShooters(supabase, asProfile),
  ]);
  if (!profile) return notImpersonating();

  await logAction(supabase, viewer.id, {
    action: AUDIT_ACTION.ADMIN_VIEW_AS,
    entityType: "profile",
    entityId: asProfile,
    metadata: {
      // Copied rather than looked up at render time: the audit log is
      // historical, and a display name that changes later must not rewrite
      // what the entry says was viewed.
      profile_display_name: profile.display_name ?? null,
      // Not shown on `/activity` — it is here for the reader of the raw
      // log, as the blast radius of the access: how many competitive
      // identities were exposed in that one view.
      shooter_count: shooters.length,
      // Always written, `null` included, so a reader can tell "the
      // consolidated dashboard" from "an old row that recorded no scope".
      discipline_code: scope.disciplineCode ?? null,
      division_code: scope.divisionCode ?? null,
    },
  });

  return { profile, shooters };
}
