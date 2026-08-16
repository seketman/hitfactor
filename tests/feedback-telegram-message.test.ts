import { describe, expect, it } from "vitest";
import {
  buildMessage,
  isFeedbackRecord,
  TELEGRAM_MAX_TEXT_LENGTH,
  TELEGRAM_PARSE_MODE,
  type FeedbackRecord,
} from "../supabase/functions/feedback-telegram/format.ts";

/**
 * The Edge Function that posts feedback to Telegram used to interpolate the
 * user's own text into a `parse_mode: "Markdown"` message. Telegram rejects the
 * **whole** message when the Markdown does not parse, so a single `_` or `*` in
 * someone's feedback dropped the notification — and dropped it silently, since
 * the trigger runs through `pg_net` and the INSERT succeeds either way. Two
 * months of feedback went out over that path with nobody able to say whether it
 * worked (#272, found while versioning the function in #273).
 *
 * Nothing could have caught it: `supabase/functions` is excluded from ESLint
 * for being Deno, and the code lived in a module vitest cannot import. Hence
 * this file — the message builder was split out so the text it produces can be
 * asserted here.
 *
 * This covers what the message *is*: escaping, budgets, truncation. What the
 * webhook does *with* it — the parse mode it declares, the order it checks the
 * secret in, the bounded call — is `feedback-telegram-handler.test.ts`, which
 * drives the real handler with a stubbed `fetch`. Splitting a module does not
 * make the leftovers safe, and it took a review to notice that this file alone
 * left the very line that broke unguarded.
 *
 * The `.ts` in the import is deliberate and uniform: Deno requires it of a
 * relative import, so `tsconfig.json` sets `allowImportingTsExtensions` and
 * every side spells it the same way. See the header of `format.ts` for why
 * that file is type-checked at all despite `exclude`.
 */

function feedback(overrides: Partial<FeedbackRecord> = {}): FeedbackRecord {
  return {
    id: 42,
    type: "bug",
    message: "El filtro no anda.",
    page_url: "/es/matches",
    user_id: "0d5a4b2c-1e3f-4a5b-8c9d-0e1f2a3b4c5d",
    ...overrides,
  };
}

/** Any `&` that does not open one of the three entities we emit. */
const DANGLING_AMPERSAND = /&(?!amp;|lt;|gt;)/;

describe("buildMessage", () => {
  describe("the messages that used to be dropped", () => {
    /**
     * Be exact about what this proves, because on its own it proves almost
     * nothing: none of these strings contains `&`, `<` or `>`, so the escaper
     * is a no-op on every one of them and the *pre-fix* code — raw
     * interpolation, no escaping — would satisfy `toContain` just as well.
     *
     * What made them fail was never the text coming out mangled. It was
     * Telegram refusing to parse it, which depends entirely on `parse_mode`.
     * So the assertion that carries the weight is the second one: these
     * characters are safe to pass through *because* the mode is HTML, where
     * `_` and `*` mean nothing. Under Markdown the identical output is a 400.
     *
     * That the webhook actually sends this mode is a separate claim, and it is
     * pinned separately: `feedback-telegram-handler.test.ts` drives the handler
     * with a stubbed `fetch` and reads the `parse_mode` it was handed. Neither
     * file covers this alone — worth knowing before either is trimmed.
     */
    it.each([
      "el filtro no anda_para nada",
      "5 * 3 tiros",
      "no me deja subir el `csv`",
      "por qué **siempre** falla?",
      "un [link](roto y un _guion",
    ])("carries %j through untouched", (message) => {
      expect(buildMessage(feedback({ message }))).toContain(message);
    });

    it("escapes for the mode the handler actually sends", () => {
      expect(TELEGRAM_PARSE_MODE).toBe("HTML");
    });

    it("leaves Markdown's metacharacters alone, and HTML's it does not", () => {
      // The asymmetry in one place. Escaping `_` or `*` would be wrong under
      // HTML — they would arrive as literal backslashes — and escaping `<` is
      // mandatory. A future edit that "adds more escaping" fails here.
      const text = buildMessage(feedback({ message: "_*`[]() <&>" }));
      expect(text).toContain("_*`[]() &lt;&amp;&gt;");
    });
  });

  describe("HTML escaping", () => {
    it("escapes the three characters Telegram's HTML mode reserves", () => {
      const text = buildMessage(
        feedback({ message: "a < b & b > c" }),
      );
      expect(text).toContain("a &lt; b &amp; b &gt; c");
    });

    it("escapes the ampersand once, not twice", () => {
      // `&` has to be replaced before `<`, or the ampersand that `&lt;`
      // introduces gets escaped again and Telegram shows `&amp;lt;`.
      const text = buildMessage(feedback({ message: "<script>" }));
      expect(text).toContain("&lt;script&gt;");
      expect(text).not.toContain("&amp;lt;");
    });

    it("escapes the row's other columns too, not only the message", () => {
      const text = buildMessage(
        feedback({ page_url: "/es/matches?q=a&b=<c>", type: "a<b" }),
      );
      expect(text).toContain("/es/matches?q=a&amp;b=&lt;c&gt;");
      expect(text).toContain("(a&lt;b)");
    });
  });

  describe("length", () => {
    /**
     * 4000 characters is what the table's CHECK allows, and it reads like it
     * fits under Telegram's 4096 until every one of them is an `&`: escaped,
     * that is 20 000 characters and a 400 back — the same silent drop by a
     * different route.
     */
    it.each([
      ["ampersands", "&".repeat(4000)],
      ["angle brackets", "<>".repeat(2000)],
      ["plain text", "a".repeat(4000)],
      ["emoji", "🐛".repeat(2000)],
    ])("fits a 4000-character message of %s", (_label, message) => {
      const text = buildMessage(feedback({ message }));
      expect(text.length).toBeLessThanOrEqual(TELEGRAM_MAX_TEXT_LENGTH);
    });

    /**
     * Without this, "fits" is satisfied by returning nothing at all — a budget
     * off by one in `escapeWithinBudget` empties the message and every length
     * assertion above still passes. What arrives has to be a long message that
     * was cut, not a short one that survived.
     */
    it.each([
      ["ampersands", "&".repeat(4000)],
      ["plain text", "a".repeat(4000)],
      ["emoji", "🐛".repeat(2000)],
    ])("spends the budget it has when truncating %s", (_label, message) => {
      const text = buildMessage(feedback({ message }));
      expect(text.length).toBeGreaterThan(TELEGRAM_MAX_TEXT_LENGTH - 8);
      expect(text).toContain("[…]");
    });

    it("caps every column on its own, not just the total", () => {
      // Aggregate length alone would accept one field overshooting while
      // another undershoots by the same amount. Each is budgeted separately,
      // so each is checked separately: the message must still get the bulk of
      // the 4096, which is the only reason the caps exist.
      const text = buildMessage(
        feedback({
          id: "9".repeat(500),
          type: "x".repeat(500),
          message: "&".repeat(4000),
          page_url: "/".repeat(2000),
          user_id: "u".repeat(500),
        }),
      );

      expect(text.length).toBeLessThanOrEqual(TELEGRAM_MAX_TEXT_LENGTH);
      for (const [field, char] of [
        ["id", "9"],
        ["type", "x"],
        ["page_url", "/"],
        ["user_id", "u"],
      ] as const) {
        const run = text.match(new RegExp(`${char}+`))?.[0] ?? "";
        expect(run.length, `${field} was not capped`).toBeLessThanOrEqual(200);
      }
      expect(text.match(/(&amp;)+/)?.[0].length).toBeGreaterThan(2000);
    });

    /**
     * The arithmetic that keeps `escapeWithinBudget`'s empty-output branch
     * unreachable.
     *
     * Four fields capped at 200 plus the literal scaffolding leave the message
     * something like 3200 characters, which is why `room <= 0` never fires.
     * Nothing enforces that: raising the field cap without redoing the sum
     * would start returning empty notifications, silently, on exactly the long
     * feedback worth reading. This is the sum, written down.
     */
    it("leaves the message the lion's share of the budget", () => {
      const scaffolding = buildMessage(
        feedback({
          id: "9".repeat(500),
          type: "x".repeat(500),
          message: "",
          page_url: "/".repeat(2000),
          user_id: "u".repeat(500),
        }),
      ).length;

      expect(TELEGRAM_MAX_TEXT_LENGTH - scaffolding).toBeGreaterThan(3000);
    });

    it("never truncates in the middle of an escape sequence", () => {
      // Slicing the finished string would: the cut lands inside `&amp;` and
      // Telegram gets a half-written entity, which is a 400 again.
      const text = buildMessage(feedback({ message: "&".repeat(4000) }));
      expect(text).not.toMatch(DANGLING_AMPERSAND);
    });

    it("never truncates in the middle of a code point", () => {
      const text = buildMessage(feedback({ message: "🐛".repeat(2000) }));
      expect(text).not.toContain("�");
      expect([...text].every((char) => char.codePointAt(0)! !== 0xd83d)).toBe(
        true,
      );
    });

    it("leaves a message that already fits untouched, marker and all", () => {
      const text = buildMessage(feedback({ message: "corto" }));
      expect(text).toContain("corto");
      expect(text).not.toContain("[…]");
    });
  });

  describe("the rest of the message", () => {
    it.each([
      ["bug", "🐛"],
      ["suggestion", "💡"],
      ["other", "📝"],
      ["something-new", "📝"],
    ])("opens a %s with %s", (type, emoji) => {
      expect(buildMessage(feedback({ type }))).toMatch(
        new RegExp(`^${emoji} <b>Feedback #42</b>`),
      );
    });

    it("stands in for a missing page_url", () => {
      expect(buildMessage(feedback({ page_url: null }))).toContain(
        "<code>—</code>",
      );
    });
  });
});

describe("isFeedbackRecord", () => {
  it("accepts the row the trigger sends", () => {
    expect(isFeedbackRecord(feedback())).toBe(true);
    expect(isFeedbackRecord(feedback({ page_url: null }))).toBe(true);
  });

  it("accepts a row with no page_url key at all", () => {
    // Not the same shape as an explicit `null`, and the likelier one: a JSON
    // payload assembled elsewhere simply omits the column.
    const { page_url: _omitted, ...withoutPageUrl } = feedback();
    expect(isFeedbackRecord(withoutPageUrl)).toBe(true);
  });

  it("accepts the bigserial id whether it arrives as a number or a string", () => {
    expect(isFeedbackRecord(feedback({ id: 42 }))).toBe(true);
    expect(isFeedbackRecord(feedback({ id: "42" }))).toBe(true);
  });

  it.each([
    ["null", null],
    ["a primitive", 7],
    ["a string", "record"],
    ["an array", []],
    ["an empty object", {}],
    ["a row with no message", { ...feedback(), message: undefined }],
    ["a row whose message is not a string", { ...feedback(), message: 12 }],
    ["a row with no user_id", { ...feedback(), user_id: undefined }],
    ["a row whose page_url is a number", { ...feedback(), page_url: 3 }],
    ["a row with no id", { ...feedback(), id: undefined }],
    ["a row whose id is a boolean", { ...feedback(), id: true }],
    ["a row whose id is an object", { ...feedback(), id: {} }],
    ["a row with no type", { ...feedback(), type: undefined }],
    ["a row whose type is a number", { ...feedback(), type: 1 }],
  ])("rejects %s", (_label, value) => {
    expect(isFeedbackRecord(value)).toBe(false);
  });
});
