/**
 * Builds the Telegram message for a feedback row.
 *
 * It lives apart from `index.ts` so it can be tested. `index.ts` pulls the Deno
 * runtime's type definitions over `jsr:` and reaches for `Deno.serve`, neither
 * of which vitest can resolve; this file deliberately imports nothing at all
 * and touches no global beyond the standard library.
 *
 * Everything imports it as `./format.ts`, extension included, because Deno
 * requires that of a relative import and `tsconfig.json` sets
 * `allowImportingTsExtensions` so that `tsc` accepts the same spelling.
 *
 * That flag is not cosmetic, and it is worth being accurate about why, because
 * the obvious guess is wrong: `tsconfig.json` does exclude `supabase/functions`,
 * but `exclude` only decides which files are *roots*. Once a test imports
 * `handler.ts`, tsc follows the import and type-checks it and this file along
 * with it — `tsc --listFiles` shows both. So these files are checked, and the
 * `.ts` in their own imports has to be something tsc will accept. `index.ts` is
 * the only one that escapes, because nothing type-checked imports it.
 */

/**
 * The parse mode the webhook must declare.
 *
 * #272 *was* this one string. With `"Markdown"`, an unbalanced `*` or `_` in
 * someone's feedback made Telegram reject the whole message, and the trigger's
 * `pg_net` call is asynchronous so the INSERT succeeded anyway — two months of
 * notifications that may or may not have been sent. `"HTML"` is what the
 * escaping in this file is written against; the two only work as a pair, which
 * is why the mode is declared beside the escaping rather than at the call site.
 *
 * `tests/feedback-telegram-handler.test.ts` reads the `parse_mode` the handler
 * actually hands to `fetch` and checks it against this constant — the mode
 * being right and the mode being sent are two claims, and that test is what
 * joins them.
 */
export const TELEGRAM_PARSE_MODE = "HTML";

/**
 * Telegram rejects a `sendMessage` whose text runs past this, with a 400 and
 * no partial delivery. It counts UTF-16 code units, same as `String.length`.
 */
export const TELEGRAM_MAX_TEXT_LENGTH = 4096;

/**
 * How much of any one header or footer field is allowed into the message.
 *
 * Every field around the feedback text is capped, not just the one that looks
 * unbounded. `page_url` is plain `text` and `id`, `type` and `user_id` are only
 * short because the schema says so, which this function does not get to
 * verify — it reads whatever JSON the webhook handed it. Capping all four is
 * what lets `buildMessage` promise a result that fits: the header and footer
 * have a known ceiling, so what is left for the message is always positive.
 */
const FIELD_BUDGET = 200;

const TRUNCATION_MARKER = "\n\n[…]";

const EMOJI: Record<string, string> = {
  bug: "🐛",
  suggestion: "💡",
};

const EMOJI_FALLBACK = "📝";

/**
 * The columns of `public.feedback` this function reads. All of them are
 * `not null` in the schema except `page_url`.
 */
export interface FeedbackRecord {
  id: number | string;
  type: string;
  message: string;
  page_url?: string | null;
  user_id: string;
}

/**
 * Whether a webhook payload's `record` really is a feedback row.
 *
 * Anything else is a 400 rather than a message built out of `undefined`: the
 * trigger sends the whole row, so a payload missing these columns did not come
 * from it.
 */
export function isFeedbackRecord(value: unknown): value is FeedbackRecord {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    (typeof row.id === "number" || typeof row.id === "string") &&
    typeof row.type === "string" &&
    typeof row.message === "string" &&
    typeof row.user_id === "string" &&
    (row.page_url === undefined ||
      row.page_url === null ||
      typeof row.page_url === "string")
  );
}

/**
 * The three characters Telegram's HTML parse mode reserves.
 *
 * HTML rather than Markdown, and this is the whole point of the fix: Markdown
 * has no escape that covers every case, so a lone `*` or `_` in someone's
 * feedback made Telegram reject the entire message — silently, because the
 * trigger runs through `pg_net` and the INSERT succeeds regardless. HTML mode
 * has exactly three reserved characters and escaping them is total.
 *
 * `&` goes first, or the ampersands introduced by the other two get escaped a
 * second time and `<` arrives as `&amp;lt;`.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Escapes `value`, keeping the result within `budget` characters.
 *
 * It re-escapes character by character instead of slicing the finished string
 * because a slice can land in the middle of `&amp;`, and a half-written entity
 * is the same 400 this function exists to avoid. Iterating the string yields
 * whole code points, so an emoji is not split down the middle either.
 */
function escapeWithinBudget(value: string, budget: number): string {
  const escaped = escapeHtml(value);
  if (escaped.length <= budget) return escaped;

  // No budget even for the marker. Unreachable through `buildMessage` as the
  // constants stand — the fields are capped hard enough that the message is
  // always left thousands of characters — and kept only so this remains a
  // total function. `leaves the message the lion's share of the budget` in the
  // test guards the margin rather than the exact boundary: it trips long
  // before this branch could fire, which is the point, since raising
  // FIELD_BUDGET without redoing the sum is how it would come alive — silently,
  // as an empty notification, on the long feedback worth reading.
  const room = budget - TRUNCATION_MARKER.length;
  if (room <= 0) return "";

  let out = "";
  for (const char of value) {
    const piece = escapeHtml(char);
    if (out.length + piece.length > room) break;
    out += piece;
  }
  return out + TRUNCATION_MARKER;
}

/**
 * The message body posted to Telegram, guaranteed to fit in one `sendMessage`.
 *
 * The header and footer are measured first and whatever is left is what the
 * feedback text gets. A `message` is capped at 4000 characters by the table's
 * CHECK, which sounds like it fits until every one of them is an `&` and the
 * escaped form is five times longer.
 */
export function buildMessage(record: FeedbackRecord): string {
  const emoji = EMOJI[record.type] ?? EMOJI_FALLBACK;

  const header =
    `${emoji} <b>Feedback #${escapeWithinBudget(String(record.id), FIELD_BUDGET)}</b> ` +
    `(${escapeWithinBudget(record.type, FIELD_BUDGET)})\n\n`;

  const footer =
    `\n\nPage: <code>` +
    `${escapeWithinBudget(record.page_url ?? "—", FIELD_BUDGET)}</code>\n` +
    `User: <code>${escapeWithinBudget(record.user_id, FIELD_BUDGET)}</code>`;

  const budget = TELEGRAM_MAX_TEXT_LENGTH - header.length - footer.length;
  return header + escapeWithinBudget(record.message, budget) + footer;
}
