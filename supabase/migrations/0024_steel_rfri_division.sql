-- =====================================================================
-- HitFactor — RFRI (rimfire rifle) division for Steel Challenge
-- =====================================================================
-- Steel Challenge shipped with seven divisions in 0001: PISTOLA,
-- REVOLVER, OPEN, ROOKIE, IRON, OPTIC and PCC. Rimfire rifle was not
-- among them, so a PractiScore report carrying that division fails the
-- import outright — `requireDivision` throws UNKNOWN_DIVISION rather than
-- dropping the rows, which is the right behaviour but leaves the match
-- unimportable.
--
-- It does get shot: "Steel Challenge 090826" (2026-08-08) ran it with
-- seven competitors, which is what surfaced the gap.
--
-- `RFRI` is SCSA's own code — Rimfire Rifle Iron Sight. The display name
-- is "Minirifle" because that is what the clubs, the entry lists and the
-- PractiScore reports all call it locally; the code stays canonical so it
-- lines up with the rest of the SCSA division set. If the optic variant
-- ever appears it is `RFRO`, and at that point this one may be worth
-- renaming to distinguish the two.
--
-- Same shape as 0016 (Classic for FBI), 0017 (Classic Manual for IPSC)
-- and 0019 (Optic for FBI): one row, no backfill, nothing to undo.
--
-- The parser side needs its own change — `division-registry.ts` maps the
-- label the report prints ("Minirifle") to this code. A row here without
-- that alias would still fail.
-- =====================================================================

insert into public.divisions (discipline_id, code, name) values
  ((select id from public.disciplines where code = 'steel_challenge'), 'RFRI', 'Minirifle')
on conflict (discipline_id, code) do nothing;
