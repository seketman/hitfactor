-- =====================================================================
-- HitFactor — Fix the UPDATE RLS on shooters (#195)
-- =====================================================================
-- The `shooters_claim_self` policy from 0001 read:
--
--   using       (auth.role() = 'authenticated')
--   with check  (linked_user_id is null or linked_user_id = auth.uid())
--
-- `using` decides WHICH ROWS an UPDATE may touch; `with check` decides
-- WHAT THEY MAY LOOK LIKE afterwards. With `using` set to "any signed-in
-- user", every authenticated user could UPDATE EVERY row in shooters by
-- calling PostgREST directly with the anon key — which is public and
-- ships in the browser bundle.
--
-- Two consequences:
--
--   1. Identity takeover. The `with check` explicitly accepts
--      `linked_user_id is null`, so an attacker could unlink someone
--      else's shooter (leaving it free) and then claim it through the
--      normal flow, inheriting their entire history.
--   2. Vandalism: full_name / member_number / region on any shooter were
--      writable by anyone.
--
-- The application code was fine (`claimShooter` uses `.is(linked_user_id,
-- null)` and `unclaimShooter` uses `.eq(linked_user_id, userId)`), but an
-- attacker never runs the application code. The defence belongs here.
--
-- ---------------------------------------------------------------------
-- Why `to authenticated` rather than `auth.role() = 'authenticated'` in
-- the predicate:
--
-- This is not styling. If `using` carried only the ownership predicate,
-- an ANONYMOUS request would have a null `auth.uid()` and would evaluate
-- `linked_user_id is null` → TRUE for every unclaimed shooter. That is:
-- we would close identity takeover and open anonymous editing of every
-- free shooter. `to authenticated` shuts that down before any row is
-- examined, and Postgres evaluates it once per query instead of once per
-- row.
--
-- ---------------------------------------------------------------------
-- Verified this does not break imports: the only two UPDATE operations
-- against `shooters` in the whole codebase are `claimShooter` and
-- `unclaimShooter` (src/lib/db/shooters.ts), both on `linked_user_id`.
-- `resolveShootersBulk` and `findOrCreateShooter`
-- (src/lib/import/shooter-resolution.ts) only SELECT and INSERT.
--
-- ---------------------------------------------------------------------
-- Known residual: a signed-in user can still edit any column of an
-- UNCLAIMED shooter, because claiming needs write access to exactly
-- those rows and RLS cannot restrict per column. Identity takeover and
-- edits to other people's claimed shooters are both closed, which was
-- the severe part. Closing the rest needs a BEFORE UPDATE trigger
-- freezing everything but `linked_user_id`; evaluated separately, so a
-- security fix doesn't ship new surface alongside it.
-- =====================================================================

drop policy if exists "shooters_claim_self" on public.shooters;

create policy "shooters_claim_self"
  on public.shooters for update
  to authenticated
  using (
    -- Rows I may act on: the free ones (to claim) and the ones already
    -- mine (to edit or unlink). Somebody else's, no.
    linked_user_id is null
    or linked_user_id = (select auth.uid())
  )
  with check (
    -- States I may leave them in: free (my own unclaim) or mine. Never
    -- linked to a third party.
    linked_user_id is null
    or linked_user_id = (select auth.uid())
  );

comment on table public.shooters is
  'Shooter identities as they appear on match sheets. UPDATE is restricted by RLS to unclaimed or own rows — see 0021.';
