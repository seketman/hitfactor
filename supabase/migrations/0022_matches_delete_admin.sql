-- =====================================================================
-- HitFactor — Let admins delete any match (#197)
-- =====================================================================
-- Four layers disagreed about how far an admin's authority reaches over
-- a match imported by somebody else:
--
--   src/lib/permissions.ts   admin may edit "club, min_shots, delete"
--   0014 matches_update_admin  admin may UPDATE      → club, min_shots OK
--   (nothing)                  admin may DELETE      → denied
--   MatchActionsBar.tsx        renders nothing for a non-importer admin
--
-- The scope has now been decided deliberately: an admin has the same
-- authority as the importer over the three actions, delete included.
-- This policy is the missing half — 0014 covered UPDATE, this covers
-- DELETE.
--
-- Deleting is the destructive one, so it is worth being explicit about
-- what it drags along: `match_entries`, `stages` and `stage_results`
-- cascade from `matches`, so this removes the whole match. It does NOT
-- touch `shooters` (identities and their claims survive) nor `firearms`.
-- The action is recorded in `audit_log` as `match.delete`, with the
-- match name, date and discipline snapshotted in the metadata, because
-- once the row is gone that entry is the only trace left.
--
-- `to authenticated` + `(select auth.uid())`: the same shape used in
-- 0021. The subquery is what keeps Postgres from re-evaluating auth per
-- row (Supabase's `auth_rls_initplan` advisory — #207 tracks bringing
-- the older policies up to this form).
-- =====================================================================

create policy "matches_delete_admin"
  on public.matches for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.is_admin = true
    )
  );
