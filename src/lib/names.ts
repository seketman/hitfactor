/**
 * Comparison keys for shooter names.
 *
 * There is no single right way to normalize a competitor's name, and this repo
 * deliberately has three. They differ on one axis — whether two spellings that
 * differ only by an accent are the same person — and the answer genuinely
 * depends on what is being compared:
 *
 * | Key | Accents | Case | Punctuation | Compares |
 * |---|---|---|---|---|
 * | `shooterNameKey` (here) | preserved | lower | kept | names that must resolve to one `shooters` row — a parsed name against the database (`import/stage-attach.ts`), and the same competitor across the files of one import before any of it is written (`parsers/steel-challenge-pdf.ts`) |
 * | `accentFoldedName` (`parsers/fat-pdf.ts`) | folded | UPPER | kept | one competitor against themselves, across sections of a single PDF |
 * | `claimNameKey` (`import/match-claim.ts`) | folded | lower | `,` `.` dropped | a user's claim against candidate shooters |
 *
 * The two folding variants are not mistakes and must not be merged into this
 * one. `fat-pdf` deduplicates inside a document that is known to spell the same
 * competitor both ways in the same file, so folding is what makes the two rows
 * meet. `match-claim` is fuzzy on purpose — it is proposing candidates to a
 * human, who then confirms.
 *
 * This key is the strict one, and it is strict for a reason: it decides whether
 * a parsed row attaches to an existing `shooters` row. Folding accents here
 * would merge two real competitors whose surnames differ by a tilde, and the
 * result is one shooter's results silently landing on another's profile. There
 * is no error to notice — the import succeeds.
 *
 * If you are tempted to unify all three, read #124 first; that was the original
 * proposal and it was withdrawn for this reason.
 */

/**
 * Canonical key for matching a parsed name against a `shooters.full_name`
 * already stored in the database: lowercase, whitespace collapsed, **accents
 * preserved**.
 *
 * Suffix stripping is not done here. Parsers run `stripNameSuffixes` before a
 * name gets this far, so both sides of the comparison already carry the same
 * canonical form.
 */
export function shooterNameKey(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}
