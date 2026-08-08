-- =====================================================================
-- HitFactor — Bring every RLS policy to the current form (#207)
-- =====================================================================
-- Two mechanical transformations, applied to every policy that predates
-- 0021. No policy changes who it lets in.
--
--   1. `auth.role() = 'authenticated'` in the predicate
--      → the `to authenticated` clause.
--
--      Supabase deprecated `auth.role()`. The clause is also evaluated
--      before any row is examined, whereas the predicate runs per row.
--
--   2. `auth.uid()` → `(select auth.uid())`.
--
--      Postgres cannot prove `auth.uid()` is stable inside the query, so
--      it re-evaluates it for every row. Wrapping it in a subquery lets
--      the planner hoist it into an InitPlan and call it once. This is
--      Supabase's `auth_rls_initplan` advisory.
--
-- Negligible on `matches` today. It is not negligible on `match_entries`
-- and `stage_results`, which grow by hundreds of rows per import and are
-- read with `.in(...)` over large sets by the dashboard.
--
-- ---------------------------------------------------------------------
-- WHAT THIS DOES **NOT** FIX
--
-- An earlier reading of this had it closing an anonymous-sign-in hole.
-- It does not. Anonymous users receive the `authenticated` Postgres role
-- (https://supabase.com/docs/guides/auth/auth-anonymous), so
-- `to authenticated` admits them exactly as `auth.role() =
-- 'authenticated'` did. The two forms are equivalent on that axis.
--
-- Telling an anonymous user from a permanent one needs the `is_anonymous`
-- JWT claim, in a `restrictive` policy. That is deliberately not done
-- here: if the claim is ever absent from a token,
-- `(auth.jwt()->>'is_anonymous')::boolean` is NULL, `NULL is false` is
-- false, and a restrictive policy would deny every request. Shipping that
-- to defend a feature which is currently switched off is the wrong trade.
-- The control is the dashboard toggle; if anonymous sign-ins are ever
-- enabled, the guards go in then, deliberately and tested.
--
-- ---------------------------------------------------------------------
-- SAFETY
--
-- Every policy is dropped and recreated with the same predicate. Between
-- the drop and the create there is no policy, and RLS denies by default,
-- so the failure mode is closed rather than open — but run the file as
-- one batch, not statement by statement.
--
-- `tests/rls-write-policies.test.ts` parses the effective policy set out
-- of these files and fails if a write policy stops being tied to
-- `auth.uid()`, which is the mistake this kind of bulk rewrite invites.
-- =====================================================================

-- ---------- profiles --------------------------------------------------
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ---------- disciplines / divisions (lookup tables) -------------------
drop policy if exists "disciplines_select_all" on public.disciplines;
create policy "disciplines_select_all"
  on public.disciplines for select
  to authenticated
  using (true);

drop policy if exists "divisions_select_all" on public.divisions;
create policy "divisions_select_all"
  on public.divisions for select
  to authenticated
  using (true);

-- ---------- shooters --------------------------------------------------
-- `shooters_claim_self` (UPDATE) is already correct — fixed in 0021 for
-- #195. Not touched here.
drop policy if exists "shooters_select_all" on public.shooters;
create policy "shooters_select_all"
  on public.shooters for select
  to authenticated
  using (true);

drop policy if exists "shooters_insert_authenticated" on public.shooters;
create policy "shooters_insert_authenticated"
  on public.shooters for insert
  to authenticated
  with check (true);

-- ---------- matches ---------------------------------------------------
drop policy if exists "matches_select_all" on public.matches;
create policy "matches_select_all"
  on public.matches for select
  to authenticated
  using (true);

drop policy if exists "matches_insert_authenticated" on public.matches;
create policy "matches_insert_authenticated"
  on public.matches for insert
  to authenticated
  with check ((select auth.uid()) = imported_by_user_id);

drop policy if exists "matches_update_importer" on public.matches;
create policy "matches_update_importer"
  on public.matches for update
  to authenticated
  using ((select auth.uid()) = imported_by_user_id)
  with check ((select auth.uid()) = imported_by_user_id);

drop policy if exists "matches_delete_importer" on public.matches;
create policy "matches_delete_importer"
  on public.matches for delete
  to authenticated
  using ((select auth.uid()) = imported_by_user_id);

-- Admin UPDATE, from 0014. `matches_delete_admin` (0022) is already in
-- the current form and is not touched.
drop policy if exists "matches_update_admin" on public.matches;
create policy "matches_update_admin"
  on public.matches for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.is_admin = true
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.is_admin = true
    )
  );

-- ---------- stages ----------------------------------------------------
drop policy if exists "stages_select_all" on public.stages;
create policy "stages_select_all"
  on public.stages for select
  to authenticated
  using (true);

drop policy if exists "stages_insert_match_owner" on public.stages;
create policy "stages_insert_match_owner"
  on public.stages for insert
  to authenticated
  with check (
    exists (
      select 1 from public.matches m
      where m.id = match_id and m.imported_by_user_id = (select auth.uid())
    )
  );

-- ---------- match_entries ---------------------------------------------
drop policy if exists "match_entries_select_all" on public.match_entries;
create policy "match_entries_select_all"
  on public.match_entries for select
  to authenticated
  using (true);

drop policy if exists "match_entries_insert_match_owner" on public.match_entries;
create policy "match_entries_insert_match_owner"
  on public.match_entries for insert
  to authenticated
  with check (
    exists (
      select 1 from public.matches m
      where m.id = match_id and m.imported_by_user_id = (select auth.uid())
    )
  );

-- Three authors, from 0008: match importer, site admin, or the shooter
-- themselves. Predicate preserved exactly.
drop policy if exists "match_entries_update_match_owner" on public.match_entries;
create policy "match_entries_update_match_owner"
  on public.match_entries for update
  to authenticated
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_id and m.imported_by_user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.is_admin = true
    )
    or exists (
      select 1 from public.shooters s
      where s.id = shooter_id and s.linked_user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.matches m
      where m.id = match_id and m.imported_by_user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.is_admin = true
    )
    or exists (
      select 1 from public.shooters s
      where s.id = shooter_id and s.linked_user_id = (select auth.uid())
    )
  );

-- ---------- stage_results ---------------------------------------------
drop policy if exists "stage_results_select_all" on public.stage_results;
create policy "stage_results_select_all"
  on public.stage_results for select
  to authenticated
  using (true);

drop policy if exists "stage_results_insert_match_owner" on public.stage_results;
create policy "stage_results_insert_match_owner"
  on public.stage_results for insert
  to authenticated
  with check (
    exists (
      select 1 from public.stages s
      join public.matches m on m.id = s.match_id
      where s.id = stage_id and m.imported_by_user_id = (select auth.uid())
    )
  );

drop policy if exists "stage_results_update_match_owner" on public.stage_results;
create policy "stage_results_update_match_owner"
  on public.stage_results for update
  to authenticated
  using (
    exists (
      select 1 from public.stages s
      join public.matches m on m.id = s.match_id
      where s.id = stage_id and m.imported_by_user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.stages s
      join public.matches m on m.id = s.match_id
      where s.id = stage_id and m.imported_by_user_id = (select auth.uid())
    )
  );

-- ---------- firearms / match_firearm_log ------------------------------
drop policy if exists "firearms_owner_all" on public.firearms;
create policy "firearms_owner_all"
  on public.firearms for all
  to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

drop policy if exists "match_firearm_log_owner_all" on public.match_firearm_log;
create policy "match_firearm_log_owner_all"
  on public.match_firearm_log for all
  to authenticated
  using (
    exists (
      select 1 from public.firearms f
      where f.id = match_firearm_log.firearm_id
        and f.owner_user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.match_entries me
      join public.shooters s on s.id = me.shooter_id
      where me.id = match_firearm_log.match_entry_id
        and s.linked_user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.firearms f
      where f.id = match_firearm_log.firearm_id
        and f.owner_user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.match_entries me
      join public.shooters s on s.id = me.shooter_id
      where me.id = match_firearm_log.match_entry_id
        and s.linked_user_id = (select auth.uid())
    )
  );

-- ---------- audit_log -------------------------------------------------
drop policy if exists "audit_log_select_own" on public.audit_log;
create policy "audit_log_select_own"
  on public.audit_log for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "audit_log_insert_own" on public.audit_log;
create policy "audit_log_insert_own"
  on public.audit_log for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- ---------- feedback --------------------------------------------------
drop policy if exists "feedback_select_own" on public.feedback;
create policy "feedback_select_own"
  on public.feedback for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "feedback_insert_own" on public.feedback;
create policy "feedback_insert_own"
  on public.feedback for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- ---------- ammunition_types / firearm_usage_log ----------------------
-- These two (0010, 0011) already wrap `auth.uid()` in a subquery; they
-- only lack the `to` clause. Without it the policy is evaluated for every
-- role including `anon`, where `auth.uid()` is null and
-- `owner_user_id = null` yields NULL — denied, so this was never a hole.
-- Recreated anyway so the whole schema reads the same way and the
-- guardrail test needs no exceptions.
drop policy if exists "ammunition_types_owner_all" on public.ammunition_types;
create policy "ammunition_types_owner_all"
  on public.ammunition_types for all
  to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

drop policy if exists "firearm_usage_log_owner_all" on public.firearm_usage_log;
create policy "firearm_usage_log_owner_all"
  on public.firearm_usage_log for all
  to authenticated
  using (
    exists (
      select 1 from public.firearms f
      where f.id = firearm_id
        and f.owner_user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.firearms f
      where f.id = firearm_id
        and f.owner_user_id = (select auth.uid())
    )
  );
