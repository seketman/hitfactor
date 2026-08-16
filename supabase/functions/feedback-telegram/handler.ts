import {
  buildMessage,
  isFeedbackRecord,
  TELEGRAM_PARSE_MODE,
} from "./format.ts";

/**
 * The whole webhook, minus the two things only Deno can provide.
 *
 * `index.ts` used to hold all of this, and nothing checked what it did: ESLint
 * ignores the directory for being Deno, no type-checked file imports `index.ts`
 * so `tsc` never reaches it, and vitest cannot import a module that calls
 * `Deno.serve` at load. (`handler.ts` and `format.ts` *are* type-checked — the
 * tests import them, and tsc follows an import past `exclude`.)
 *
 * Covering it by reading the file as text was tried first and did not work;
 * `tests/feedback-telegram-handler.test.ts` records which mutations walked
 * through it. So the environment and the network arrive as arguments instead.
 * Everything below is ordinary TypeScript that vitest imports and drives
 * directly, and `index.ts` is left with nothing but the wiring.
 */
export interface Dependencies {
  /** `Deno.env.get` in production; a plain map in tests. */
  getSecret(name: string): string | undefined;
  /** `globalThis.fetch` in production; a stub that records the call in tests. */
  fetch: typeof fetch;
  /**
   * Overrides `TELEGRAM_TIMEOUT_MS`, for tests only.
   *
   * It exists because asserting "the call is bounded" is not the same as
   * asserting it is bounded *by the right number*, and review found the gap:
   * hardcoding `AbortSignal.timeout(30000)` at the call site — past the
   * trigger's budget, back to the failure that looks like nothing happened —
   * left the whole suite green. A test can now set a few milliseconds and watch
   * a hanging request actually come back, which no literal at the call site
   * would satisfy.
   */
  timeoutMs?: number;
}

/**
 * Ceiling on the call to Telegram, kept under the 5000 ms the trigger allows
 * (`0025_feedback_telegram_webhook.sql`).
 *
 * Losing that race is worse than it sounds: when `pg_net` gives up first it
 * writes no `status_code` and no `content`, so the query in `README.md` — the
 * only window onto this path — shows an empty row and the failure looks like
 * nothing at all. Answering first, even to say the call timed out, is what
 * keeps a slow Telegram distinguishable from a broken one.
 *
 * The 2000 ms it leaves is headroom, not slack. A cold isolate has to boot
 * before this deadline starts counting, `AbortSignal.timeout` fires late by a
 * margin that grows on a cold process, and the reply still has to reach
 * `pg_net` — none of which can be measured from a laptop, and a function
 * invoked once every few weeks is cold every time. The headroom is asserted,
 * not merely the ordering, in `feedback-telegram-handler.test.ts`: a value
 * under it is what a reasonable person picks when Telegram looks slow.
 */
export const TELEGRAM_TIMEOUT_MS = 3000;

export const TELEGRAM_API_ORIGIN = "https://api.telegram.org";

/**
 * How much of a failure's explanation is kept.
 *
 * Every one of them ends up in `net._http_response.content`, and the query in
 * `README.md` reads 400 characters of that. Anything past this is in the row
 * but not in the view anybody actually opens, so the cap is set to leave room
 * for the JSON around it rather than to any limit of Telegram's.
 *
 * One number for both the unreachable case and Telegram's own rejection: they
 * are read in the same place, by the same person, for the same reason.
 */
const DIAGNOSIS_BUDGET = 250;

class MissingSecret extends Error {
  constructor(name: string) {
    super(`Missing secret: ${name}`);
    this.name = "MissingSecret";
  }
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

/**
 * Constant-time comparison of the presented secret against the expected one.
 *
 * Comparing digests rather than the strings themselves keeps the running time
 * independent of both content and length: SHA-256 output is always 32 bytes,
 * so the loop runs the same number of rounds whatever arrives. Over HTTPS with
 * network jitter in front of it this is nearer hygiene than a live threat, but
 * it costs one hash.
 *
 * **No test asserts the timing property, and none can usefully.** Replacing
 * this whole body with `presented === expected` keeps every case below green,
 * which review confirmed by doing it. A statistical timing assertion in CI is
 * a flake generator, so the tests pin the answers and this comment is the only
 * thing standing behind the method. Said plainly rather than left for someone
 * to discover: the property survives on review, not on the suite.
 */
export async function secretsMatch(
  presented: string | null,
  expected: string,
): Promise<boolean> {
  if (presented === null) return false;
  const [a, b] = await Promise.all([sha256(presented), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Turns a failed `fetch` into something worth reading, minus the credential.
 *
 * Forwarding `error.name` alone is safe and nearly useless: a DNS failure, a
 * refused connection and a bad certificate all arrive as `TypeError` with the
 * message "fetch failed". What separates them is in the `cause`, shaped like
 *
 *   error sending request for url (https://api.telegram.org/bot<TOKEN>/…):
 *   client error (Connect): dns error: failed to lookup address information
 *
 * — the diagnosis is the tail and the token appears only inside the URL. So
 * the URL goes and the tail stays.
 *
 * The token is struck first and by value rather than trusting the URL pattern
 * to cover it. One regex is too few to stand between a bot token and a log
 * anybody can read.
 */
export function describeFetchFailure(error: unknown, token: string): string {
  const failure = error as Error;
  // `typeof`, not `instanceof Error`: an `Error` whose `message` was overwritten
  // with a number makes `replaceAll` throw. This runs inside the `catch` around
  // the Telegram call, and that catch has nothing outside it — a throw from
  // here escapes the handler entirely. A redactor that can raise is not one.
  const raw = (failure?.cause as Error | undefined)?.message;
  const cause = typeof raw === "string" ? raw : "";
  const detail = cause
    .replaceAll(token, "<token>")
    .replace(/https?:\/\/\S+?(?=[)\s]|$)/g, "<url>");

  return `${failure.name}: ${detail || "no further detail"}`.slice(0, DIAGNOSIS_BUDGET);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Handles one webhook delivery.
 *
 * Every answer other than 200 lands in `net._http_response.content`, which is
 * where the query in `supabase/functions/README.md` looks — so each failure
 * says what went wrong in words. A webhook that fails without saying anything
 * is how this path went two months with nobody able to confirm it worked.
 */
export async function handleRequest(
  req: Request,
  deps: Dependencies,
): Promise<Response> {
  const requireSecret = (name: string): string => {
    // These used to be read with a `!`, which lies: with the variable unset
    // the URL became `/botundefined/`, Telegram answered 404, and the function
    // returned the same opaque 500 as every other failure.
    const value = deps.getSecret(name);
    if (!value) throw new MissingSecret(name);
    return value;
  };

  // The gate comes first, ahead of reading the body and ahead of the secrets
  // it does not need. Parsing first meant malformed JSON from a stranger
  // returned 500 rather than 401, and reading the Telegram credentials first
  // would tell a caller who never authenticated which of them is unset.
  //
  // One thing unavoidably stays in front of the gate: the gate's own secret. A
  // stranger arriving while `FEEDBACK_WEBHOOK_SECRET` is unset learns that
  // much — the variable's name, never its value, and only from a deployment
  // that is already refusing everyone.
  let secret: string;
  try {
    secret = requireSecret("FEEDBACK_WEBHOOK_SECRET");
  } catch (error) {
    // Fail closed. With no secret configured there is nothing to check the
    // header against, and treating that as "everyone passes" would reopen the
    // endpoint to the internet — see 0025_feedback_telegram_webhook.sql.
    return json({ ok: false, error: (error as Error).message }, 500);
  }

  if (!(await secretsMatch(req.headers.get("x-webhook-secret"), secret))) {
    return new Response("Unauthorized", { status: 401 });
  }

  let token: string;
  let chatId: string;
  try {
    token = requireSecret("TELEGRAM_BOT_TOKEN");
    chatId = requireSecret("TELEGRAM_CHAT_ID");
  } catch (error) {
    return json({ ok: false, error: (error as Error).message }, 500);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body is not valid JSON" }, 400);
  }

  const record = (body as { record?: unknown } | null)?.record;
  if (!isFeedbackRecord(record)) {
    return json(
      { ok: false, error: "Payload carries no feedback row in `record`" },
      400,
    );
  }

  let res: Response;
  try {
    res = await deps.fetch(`${TELEGRAM_API_ORIGIN}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: buildMessage(record),
        parse_mode: TELEGRAM_PARSE_MODE,
      }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? TELEGRAM_TIMEOUT_MS),
    });
  } catch (error) {
    // DNS failure, refused connection, TLS error, or our own timeout. Letting
    // this throw would hand the runtime's generic "Internal Server Error" to
    // `pg_net` and leave the reason in the function's logs alone — the opaque
    // failure this whole change is about, restored by the likeliest route.
    return json(
      {
        ok: false,
        error: `Telegram unreachable: ${describeFetchFailure(error, token)}`,
      },
      500,
    );
  }

  if (res.ok) return json({ ok: true }, 200);

  // Telegram explains its own rejections ("can't parse entities…", "chat not
  // found") and the explanation is the whole diagnosis. Its reply carries no
  // credential: the bot token travels in the URL, which is never echoed.
  //
  // The body can still fail to arrive — the abort signal governs streaming
  // too, so a reply that starts under the deadline and then trickles is cut
  // here. Saying so beats an empty `error`, which reads as nothing to report.
  const detail = await res.text().catch(() => "");
  return json(
    {
      ok: false,
      status: res.status,
      error: detail.slice(0, DIAGNOSIS_BUDGET) || "response body unavailable",
    },
    500,
  );
}
