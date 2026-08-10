# Import flow

## Business rules

1. **Any authenticated user can import.** Matches are shared data: every
   authenticated user sees them.

2. **Only the importer can delete the match.** There is no edit — if it's
   wrong, delete it and re-import.

3. **Automatic deduplication.** The UNIQUE on `matches` is
   `(discipline_id, name, date, region) NULLS NOT DISTINCT`, so two imports
   with a NULL region **are** considered equal (necessary for Tiro FBI, which
   has no region per match). If someone tries to re-import, it returns
   `MATCH_ALREADY_EXISTS`.

4. **Match overall first, stages after** *(IPSC)*. `Stage Results` files
   require the overall match to exist already (matched on `name + date`, with
   a fuzzy fallback when the stage suffix is unknown). Otherwise,
   `MATCH_NOT_FOUND`.

5. **Steel Challenge and Tiro FBI carry stages embedded in a single file.**
   The importer detects them and inserts them in the same operation as the
   overall match.

6. **Only the match's importer can add stages to it.** `NOT_MATCH_OWNER`
   otherwise.

7. **Re-importing a stage is idempotent.** `stage_results` are written with an
   `upsert` on `(stage_id, match_entry_id)`, so they don't duplicate.

8. **Shooter resolution** *(critical — race condition fix)*. For each shooter
   in the file:
   - Look up by `(full_name ILIKE, member_number)`.
   - If it exists, reuse it.
   - If not, create a new `shooter` (unclaimed).

   Resolution is **sequential and cached** within the import: a single
   `findOrCreateShooter` call per unique shooter. This used to be done with
   `Promise.all` and produced duplicates when the same shooter appeared in
   several divisions of the CSV (typical for Tiro FBI).

## Supported formats

| Discipline | Format | Single file? | Stages embedded? |
|---|---|---|---|
| IPSC | PractiScore HTML | No | No (a separate file per stage) |
| IPSC | PractiScore PDF | Yes | Depends on the report |
| IPSC | WinMSS PDF (ipsc.org.ar) | Yes | No (a separate overall and stages PDF) |
| IPSC | FAT PDF (official rankings) | Yes | No |
| Steel Challenge | PractiScore HTML | Yes | Yes |
| Steel Challenge | PractiScore PDF (iPhone) | No — N stage PDFs at once | Yes |
| Tiro FBI | Google Sheets CSV | Yes | No (FBI does not expose stages) |

Format selection lives in
[`src/lib/parsers/index.ts`](../src/lib/parsers/index.ts) and is a **registry
of descriptors**, not a hardcoded if-ladder (issue #119). Each format declares
`{ detect, parse }` and is added by pushing an entry to the list, so the
dispatcher is closed to modification. Order matters: the first `detect` that
returns true wins, so the more specific heuristics go first.

- Text (`parseFile`): FBI CSV is checked first, then HTML — inside HTML, Steel
  Challenge is checked and PractiScore IPSC is the catch-all.
- PDF (`parsePdfBatch`): Steel Challenge (multi-file) is checked first, then
  the single-file registry — PractiScore PDF, WinMSS, FAT.

Steel Challenge is the only format that accepts several PDFs in one import;
everything else rejects more than one file.

## Multiple identities

A user can have several `shooters` linked (one per spelling of their name used
by the different reports). The system supports this end to end:

- `findClaimCandidates` uses the names of already-linked shooters as
  **additional aliases** when suggesting new claims. If you already claimed
  "Demarziani, Diego D." in IPSC, that name feeds the matching for
  "Demarziani Diego" in Tiro FBI.
- `claimShooter` does not require the user to have 0 previous shooters.
- The dashboard aggregates entries from **all** identities.
- `/matches/[id]/me` looks up which of your identities took part in that match.

Tests: `tests/match-claim.test.ts`.

## Claim auto-detection

After importing,
[`src/app/[locale]/(app)/import/page.tsx`](<../src/app/[locale]/(app)/import/page.tsx>)
shows an
"Are you one of these shooters?" panel with the match's shooters that look like
the logged-in user.

Matching algorithm
([`src/lib/import/match-claim.ts`](../src/lib/import/match-claim.ts)):

- **By member number**: exact match of `member_number` against any of the
  aliases (profile + already-linked shooters).
- **By name**: normalized tokens (lowercase, no accents, no punctuation),
  requiring the smaller set to be contained in the larger one and to have at
  least 2 distinct tokens. This avoids false positives from common surnames.

## User flow

1. **Upload the file** (PractiScore Match Results, a Steel report, or an FBI
   CSV).
2. **If there are claim suggestions**, hit "That's me" to link.
3. **If no suggestions appeared**, go to the match (`/matches/[id]`) and hit
   "That's me" on your row manually.
4. **(Optional) Assign the firearm used** in `/matches/[id]/me` with the
   `FirearmSelector`.
5. **Upload Stage Results** *(IPSC only)*, one file per stage.
6. **Dashboard** → KPIs and progress updated.

## How the file reaches the server

The file **does not travel in the server action's body**. The browser uploads
it straight to Supabase Storage and the server action receives only a
`{ path, filename }` reference; it then downloads the file server-side, parses
it, and deletes the staging object.

```
browser ──upload──> Storage (bucket `match-imports`)
   │                        │
   └──{path,filename}──> server action ──download──> parser ──> DB
                                 └──remove──> Storage
```

Why this, and not the obvious route of sending it in the FormData: **Vercel
caps a Function's request body at 4.5 MB** at the platform level and returns
`413 FUNCTION_PAYLOAD_TOO_LARGE` before invoking the code. WinMSS stage PDFs
go past that limit (we saw an 8 MB one with 144 pages).
`experimental.serverActions.bodySizeLimit` **cannot** raise that ceiling — it
is a Next limit, not a Vercel one, and only applies in local dev.

The pieces:

| File | Role |
|---|---|
| `supabase/migrations/0020_import_uploads_storage.sql` | Bucket + RLS policies |
| `src/lib/import/upload-to-storage.ts` | Upload from the browser |
| `src/lib/import/storage.ts` | Path validation, download and server-side cleanup |
| `ImportForm.tsx` (`uploadThenImport`) | Client wrapper: uploads, then calls the server action |

Objects go to `<user_id>/<uuid>.<ext>` and the policies require the first
segment to be the JWT's uid — that is what prevents reading or writing another
user's folder. `parseUploadedRef` validates the shape of the path before
touching Storage (tests in `tests/import-storage.test.ts`).

**Limits, and why they are explicit.** The server action accepts up to
`MAX_IMPORT_FILES` references, discards duplicates, and aborts the download if
the accumulated bytes exceed `MAX_IMPORT_TOTAL_BYTES`. This is not paranoia:
before the bucket, Vercel's 4.5 MB ceiling bounded this without anyone deciding
it. Now the references are ~100-byte JSON blobs and thousands fit in one
request, so the bound has to be written down.

**Two-level cleanup.** `cleanupImportFiles` runs on every exit path of the
server action, but it is best-effort and there are orphans it cannot cover: a
user who closes the tab mid-upload, or a multi-file batch where one fails after
the others already uploaded. For those, `purgeStaleUploads` sweeps anything
older than a day from that user's folder at the start of every import.

Beware the temptation to solve this with a Postgres cron: **deleting from
`storage.objects` with SQL does not delete the file**. It removes the metadata
row and leaves the blob orphaned in S3, still counting against the quota, with
no way to find it afterwards. You have to use the Storage API
([docs](https://supabase.com/docs/guides/storage/management/delete-objects)).

One case remains uncovered: someone who uploads a file, abandons it, and
**never imports again**. That needs a central sweep with the service role (a
scheduled Edge Function), which is a separate infrastructure decision.

The original `filename` travels alongside the path on purpose: the FAT and
Steel Challenge parsers use it as input data (match date, stage order), and the
path is a uuid.

## Partial imports: the parser stops rather than importing half the data

If the WinMSS parser reads **some** rows on a page but misses others, it throws
and nothing is imported.

This is not paranoia: the match *CENTRO REPUBLICA CHALLENGE 2026 BY GR PCC
Edition* came in with **one shooter out of eleven**. The scores carried a
thousands separator, the row regex did not account for it, and the DQ rows —
which go through a different regex, with no points column — matched anyway.
None of the guards at the time fired, because they all asked "did we parse
anything?" and the answer was yes. The import ended on a success screen.

Detection compares, page by page, the lines **shaped like a row** against the
ones actually parsed. A line counts as a row if it starts with
`<number> <number>` **and** contains a comma. Both conditions matter:

- Without the first, headers and footers would count.
- Without the second, a title like `2026 3RA FECHA COPA SOCIAL` would count as
  a missed row and would break that match's import.

DQ rows in the ESS format (`89 LASTNAME, Max DQ`) do not match the first
condition — a letter follows the bib number — so a division whose only shooter
was DQ'd passes without noise. That case is rare but legitimate.

**A consequence worth keeping in mind:** a PDF with one unreadable row that
used to import partially now fails entirely. This is deliberate — incomplete
data in a shared database is worse than a visible error — but if a new format
shows up, the symptom will be "nothing imports" rather than "not much imports".
The error message says which page and how many rows.

## Known errors (codes)

The code is the identity of the error. Its user-facing text lives in
`messages/*.json` under `import.importError.<CODE>` and is resolved in the
server action, which is the first point on the path that knows the locale
(#203, same criterion as `parserError`). A code with no message, or a
message with no code, fails `tests/messages-parity.test.ts`.

| Code | When it's thrown |
|---|---|
| `UNKNOWN_DISCIPLINE` | The parser returned a discipline that does not exist in `disciplines` |
| `DIVISIONS_FETCH_FAILED` | The divisions lookup could not be loaded |
| `UNKNOWN_DIVISION` | An unregistered division showed up — ask an admin to add it |
| `MATCH_INSERT_FAILED` | Generic error inserting the match |
| `MATCH_ALREADY_EXISTS` | Unique violation: that match already exists |
| `MATCH_ALREADY_EXISTS_BY_OTHER` | Someone else imported the same match; mark yourself on theirs instead |
| `MATCH_NOT_FOUND` | You uploaded a stage without the overall match; lists that day's matches |
| `MATCH_NOT_FOUND_NONE_THAT_DAY` | Same, but nothing at all has been imported for that date |
| `NOT_MATCH_OWNER` | You're trying to add stages to a match you did not import |
| `STAGE_INSERT_FAILED` | Error inserting the stage |
| `STAGE_RESULTS_INSERT_FAILED` | Error inserting the stage_results |
| `MATCH_ENTRIES_INSERT_FAILED` | Error inserting the match_entries |
| `SHOOTER_INSERT_FAILED` | Error inserting a shooter |
| `DOWNLOAD_FAILED` | The staged file could not be read back from the bucket |
| `IMPORT_TOO_LARGE` | The files together exceed the total byte budget |

The `*_INSERT_FAILED` codes carry the raw Postgres message in a `detail`
field. It is logged by the server action and never returned to the user:
showing it was the bug in #199, and dropping it entirely would leave
nothing explaining why the write failed.

### Upload errors (before reaching the server)

These are not `ImportError`s: they happen in the browser, while uploading to
the bucket, so the server action never hears about them. They are shown inside
the form and their translations live in `messages/*.json` under
`import.form.uploadError`.

| Code | When it's thrown |
|---|---|
| `not_authenticated` | No valid session at upload time (or `getUser` failed) |
| `too_large` | A file exceeds `MAX_IMPORT_FILE_BYTES` |
| `too_many` | More than `MAX_IMPORT_FILES` files in a single import |
| `bucket_missing` | The bucket does not exist — typically deployed without running migration 0020 |
| `upload_failed` | Any other upload failure (network, permissions) |

## Tests

| Test | Covers |
|---|---|
| `tests/import-match.test.ts` | The rules above with a minimal Supabase mock. Includes the regression test for the race condition with a repeated shooter. |
| `tests/match-claim.test.ts` | Name matching algorithm + multi-identity scenarios. |
| `tests/stage-resolution.test.ts` | Fuzzy match on the match name when uploading a stage. |
| `tests/import-storage.test.ts` | Validation of the path sent by the client (`parseUploadedRef`), the download byte budget, and the "cleanup never throws" contract. |
