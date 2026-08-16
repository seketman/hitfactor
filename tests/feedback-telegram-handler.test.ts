import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  describeFetchFailure,
  handleRequest,
  secretsMatch,
  TELEGRAM_API_ORIGIN,
  TELEGRAM_TIMEOUT_MS,
  type Dependencies,
} from "../supabase/functions/feedback-telegram/handler.ts";
import { TELEGRAM_PARSE_MODE } from "../supabase/functions/feedback-telegram/format.ts";

/**
 * The webhook itself, driven end to end.
 *
 * This file exists because the previous attempt did not work. The handler used
 * to live in `index.ts`, which vitest cannot import — it calls `Deno.serve` on
 * load — and which `tsconfig.json` and ESLint both exclude for being Deno. The
 * cover for it was a test that read `index.ts` as text and asserted on
 * substrings, and review dismantled it in four moves, each one a change a
 * person might plausibly make:
 *
 *   - `text: buildMessage(record)` → `text: record.message`, which restores
 *     #272 exactly, through a different line. Suite stayed green.
 *   - the `try` around the fetch deleted. Green.
 *   - the `!` on `Deno.env.get` split across two statements. Green.
 *   - `cause` added back into the error body, leaking the bot token. Green.
 *
 * A substring is not a scope and a name is not a call. So the environment and
 * the network are injected instead, `index.ts` was reduced to the two lines
 * that hand them over, and everything below drives the real handler with a
 * `fetch` that reports what it was asked to send.
 */

const SECRET = "the-shared-secret";
const TOKEN = "123456:AAHtOPnotarealtoken";
const CHAT = "-1001234567890";

const SECRETS: Record<string, string> = {
  FEEDBACK_WEBHOOK_SECRET: SECRET,
  TELEGRAM_BOT_TOKEN: TOKEN,
  TELEGRAM_CHAT_ID: CHAT,
};

const ROW = {
  id: 9,
  type: "bug",
  message: "el filtro no anda_para nada",
  page_url: "/es/matches",
  user_id: "0d5a4b2c-1e3f-4a5b-8c9d-0e1f2a3b4c5d",
};

/** What Telegram was asked to send, decoded. */
interface Sent {
  url: string;
  chat_id: string;
  text: string;
  parse_mode: string;
  signal: AbortSignal | null | undefined;
}

let sent: Sent[];
let telegram: () => Promise<Response>;

function deps(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    getSecret: (name) => SECRETS[name],
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      sent.push({ url: String(input), signal: init?.signal, ...body });
      return await telegram();
    }) as typeof fetch,
    ...overrides,
  };
}

function post(
  body: unknown,
  headers: Record<string, string> = { "x-webhook-secret": SECRET },
): Request {
  return new Request("https://edge.test/feedback-telegram", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const deliver = (body: unknown = { record: ROW }, d?: Dependencies) =>
  handleRequest(post(body), d ?? deps());

beforeEach(() => {
  sent = [];
  telegram = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
});

describe("the gate", () => {
  it.each<[string, Record<string, string>]>([
    ["no header at all", {}],
    ["a wrong secret", { "x-webhook-secret": "nope" }],
    ["an empty secret", { "x-webhook-secret": "" }],
    ["the secret in the wrong header", { authorization: SECRET }],
  ])("answers 401 to %s", async (_label, headers) => {
    const res = await handleRequest(post({ record: ROW }, headers), deps());
    expect(res.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  /**
   * The body used to be parsed before the secret was checked, so malformed
   * JSON from a stranger came back 500 instead of 401. Ordering is the whole
   * property, and it is not something a type checker has an opinion about.
   */
  it("answers 401 to a stranger even when the body is garbage", async () => {
    const res = await handleRequest(post("not json", {}), deps());
    expect(res.status).toBe(401);
  });

  it("reads no Telegram credential before the caller is known", async () => {
    const asked: string[] = [];
    const res = await handleRequest(
      post({ record: ROW }, { "x-webhook-secret": "nope" }),
      deps({
        getSecret: (name) => {
          asked.push(name);
          return SECRETS[name];
        },
      }),
    );

    expect(res.status).toBe(401);
    expect(asked).toEqual(["FEEDBACK_WEBHOOK_SECRET"]);
  });

  /**
   * With nothing to compare against, the only safe answer is to refuse
   * everyone. Accepting would reopen the endpoint to the internet: the
   * function runs with `verify_jwt` off and this header is the only lock.
   */
  it.each<[string, string | undefined]>([
    ["unset", undefined],
    // `Deno.env.get` returns "" for a variable that exists and is blank, which
    // is the likelier shape of a misconfigured deployment than a missing one.
    ["set to an empty string", ""],
  ])("fails closed when the secret it checks against is %s", async (_l, value) => {
    const attempts: Record<string, string>[] = [
      {},
      { "x-webhook-secret": "anything" },
    ];
    for (const headers of attempts) {
      const res = await handleRequest(
        post({ record: ROW }, headers),
        deps({ getSecret: () => value }),
      );
      expect(res.status).toBe(500);
      expect(await res.json()).toMatchObject({
        ok: false,
        error: "Missing secret: FEEDBACK_WEBHOOK_SECRET",
      });
      expect(sent).toHaveLength(0);
    }
  });

  it.each(["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"])(
    "names %s when it is missing, and only to an authenticated caller",
    async (missing) => {
      const getSecret = (name: string) =>
        name === missing ? undefined : SECRETS[name];

      const stranger = await handleRequest(
        post({ record: ROW }, { "x-webhook-secret": "nope" }),
        deps({ getSecret }),
      );
      expect(stranger.status).toBe(401);
      expect(await stranger.text()).not.toContain(missing);

      const trigger = await deliver({ record: ROW }, deps({ getSecret }));
      expect(trigger.status).toBe(500);
      expect(await trigger.json()).toMatchObject({
        error: `Missing secret: ${missing}`,
      });
      expect(sent).toHaveLength(0);
    },
  );
});

describe("the payload", () => {
  it.each([
    ["unparseable JSON", "not json", "Body is not valid JSON"],
    ["a body with no record", { type: "INSERT" }, "Payload carries no feedback"],
    ["a record that is not a row", { record: { id: 1 } }, "Payload carries no feedback"],
    ["a null record", { record: null }, "Payload carries no feedback"],
  ])("answers 400 to %s", async (_label, body, message) => {
    const res = await deliver(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(message);
    expect(sent).toHaveLength(0);
  });
});

describe("what Telegram is asked to send", () => {
  /**
   * The assertion the source-scanning test could not make. Swapping
   * `buildMessage(record)` for `record.message` reproduces #272 through a
   * different line — same silent drop, no escaping — and left the old suite
   * entirely green.
   */
  it("sends the built message, not the raw column", async () => {
    await deliver({ record: { ...ROW, message: "5 < 3 & no anda" } });
    expect(sent[0]!.text).toContain("5 &lt; 3 &amp; no anda");
    expect(sent[0]!.text).toContain("<b>Feedback #9</b>");
  });

  it("sends the parse mode the escaping is written for", async () => {
    await deliver();
    expect(sent[0]!.parse_mode).toBe(TELEGRAM_PARSE_MODE);
    expect(sent[0]!.parse_mode).toBe("HTML");
  });

  it("addresses the configured chat, over the configured bot", async () => {
    await deliver();
    expect(sent[0]!.chat_id).toBe(CHAT);
    expect(sent[0]!.url).toBe(`${TELEGRAM_API_ORIGIN}/bot${TOKEN}/sendMessage`);
  });

  /**
   * Unbounded, this outruns the 5000 ms the trigger allows; `pg_net` then
   * gives up first and records neither a status nor a body, so a hanging
   * Telegram is indistinguishable from nothing having happened.
   */
  it("bounds the call", async () => {
    await deliver();
    expect(sent[0]!.signal).toBeInstanceOf(AbortSignal);
    expect(sent[0]!.signal!.aborted).toBe(false);
  });
});

describe("when Telegram says no", () => {
  it("forwards its explanation, which is the whole diagnosis", async () => {
    telegram = async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 400,
          description: "Bad Request: can't parse entities",
        }),
        { status: 400 },
      );

    const res = await deliver();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, status: 400 });
    expect(body.error).toContain("can't parse entities");
  });

  it("says so rather than nothing when the body cannot be read", async () => {
    telegram = async () => ({
      ok: false,
      status: 502,
      text: () => Promise.reject(new Error("aborted mid-stream")),
    }) as unknown as Response;

    expect((await (await deliver()).json()).error).toBe(
      "response body unavailable",
    );
  });
});

describe("when Telegram cannot be reached", () => {
  /**
   * Uncaught, this returns the runtime's own bare "Internal Server Error" and
   * the reason survives only in the function's logs — which is the opaque
   * failure the whole change exists to remove, reintroduced by the likeliest
   * route an external dependency has.
   */
  it("answers in words instead of letting the throw escape", async () => {
    telegram = async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: new Error(
          `error sending request for url (${TELEGRAM_API_ORIGIN}/bot${TOKEN}/sendMessage): ` +
            `client error (Connect): dns error: failed to lookup address information`,
        ),
      });
    };

    const res = await deliver();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("dns error");
    expect(body.error).toContain("TypeError");
  });

  /**
   * The reason a whole function exists for this instead of forwarding the
   * error: the URL Deno quotes back has the bot token in the middle of it, and
   * this response is written to `net._http_response.content`, which the
   * migration's own threat model treats as readable by operators and backups.
   */
  it("never lets the bot token into the response", async () => {
    telegram = async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: new Error(
          `error sending request for url (${TELEGRAM_API_ORIGIN}/bot${TOKEN}/sendMessage): boom`,
        ),
      });
    };

    const text = await (await deliver()).text();
    expect(text).not.toContain(TOKEN);
    // Swallowed whole with the URL that carried it, so `<token>` does not
    // appear here — the by-value strike is what covers a token quoted outside
    // a URL, and that case has its own test below.
    expect(text).toContain("<url>");
  });

  it("distinguishes a timeout from an unreachable host", async () => {
    telegram = async () => {
      throw new DOMException("Signal timed out.", "TimeoutError");
    };
    expect((await (await deliver()).json()).error).toContain("TimeoutError");
  });

  /**
   * The signal is real, not decorative.
   *
   * Asserting that `sent[0].signal` is an `AbortSignal` says the call is
   * bounded; it says nothing about the bound. Review hardcoded
   * `AbortSignal.timeout(30000)` at the call site — past the trigger's 5000 ms,
   * straight back to `pg_net` giving up first and writing nothing at all — and
   * the suite stayed green. So this one hangs a request and waits for the
   * deadline the handler was given to actually fire.
   */
  it("aborts a request that never answers, on the deadline it was given", async () => {
    telegram = () => new Promise<Response>(() => {});

    const started = Date.now();
    const res = await handleRequest(
      post({ record: ROW }),
      deps({
        timeoutMs: 25,
        fetch: ((_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Signal timed out.", "TimeoutError")),
            );
          })) as typeof fetch,
      }),
    );

    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("TimeoutError");
    // Generous upper bound: the point is that it came back on ~25 ms rather
    // than on whatever a literal at the call site might say.
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("secretsMatch", () => {
  /**
   * These pin the answers. They do not pin the timing — see the note on the
   * function: `presented === expected` passes every one of them, and a
   * statistical timing assertion in CI is a flake generator. The method is
   * defended by review, and this comment exists so nobody mistakes a green
   * suite for evidence of it.
   */
  it.each([
    ["the same secret", "abc", "abc", true],
    ["a different secret of equal length", "abc", "abd", false],
    ["a prefix", "ab", "abc", false],
    ["a superstring", "abcd", "abc", false],
    ["an empty presented secret", "", "abc", false],
    ["unicode that matches", "clé—ok", "clé—ok", true],
  ] as const)("answers %s", async (_label, presented, expected, result) => {
    expect(await secretsMatch(presented, expected)).toBe(result);
  });

  it("refuses a missing header without hashing anything", async () => {
    expect(await secretsMatch(null, "abc")).toBe(false);
  });
});

describe("describeFetchFailure", () => {
  it("keeps the diagnosis and drops the URL", () => {
    const out = describeFetchFailure(
      Object.assign(new TypeError("fetch failed"), {
        cause: new Error(
          `error sending request for url (${TELEGRAM_API_ORIGIN}/bot${TOKEN}/x): ` +
            `client error (Connect): invalid peer certificate: UnknownIssuer`,
        ),
      }),
      TOKEN,
    );

    expect(out).toContain("invalid peer certificate");
    expect(out).toContain("<url>");
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain("api.telegram.org");
  });

  it("strikes the token even when it turns up outside a URL", () => {
    // The URL pattern is not the thing being relied on. If Deno ever words the
    // message differently, the token is still removed by value.
    const out = describeFetchFailure(
      Object.assign(new Error("boom"), {
        cause: new Error(`bot ${TOKEN} refused`),
      }),
      TOKEN,
    );
    expect(out).not.toContain(TOKEN);
    expect(out).toContain("<token>");
  });

  it("falls back to the name when there is no cause", () => {
    expect(describeFetchFailure(new TypeError("fetch failed"), TOKEN)).toBe(
      "TypeError: no further detail",
    );
  });

  /**
   * Bounded at both ends. An upper bound alone accepts shrinking the cap to
   * nothing — review shrank it to 100 and the suite stayed green — and the
   * diagnosis this returns is the only account of the failure anyone ever
   * sees, so a cap that quietly stops fitting one is the same silence by
   * another route.
   */
  it("keeps the cap it says it has, at both ends", () => {
    const out = describeFetchFailure(
      Object.assign(new Error("x"), { cause: new Error("y".repeat(5000)) }),
      TOKEN,
    );
    expect(out.length).toBeLessThanOrEqual(250);
    expect(out.length).toBeGreaterThanOrEqual(200);
  });
});

describe("the timeout against the trigger's", () => {
  /**
   * Two numbers in two files that must stay ordered, with no compiler able to
   * see both. `pg_net` giving up first writes neither status nor content, so
   * losing this race is the failure mode that looks like no failure at all.
   */
  it("gives up before pg_net does", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase", "migrations", "0025_feedback_telegram_webhook.sql"),
      "utf8",
    );

    // Anchored on the `http_request` argument list rather than on any quoted
    // number in the file, so an unrelated literal cannot be picked up instead.
    const args = migration.slice(migration.indexOf("supabase_functions.http_request"));
    const timeout = args.match(/'(\d+)'\s*\)/);
    expect(
      timeout,
      "The trigger's timeout could not be found in 0025. If the migration's " +
        "shape changed, teach this test the new one rather than deleting it.",
    ).not.toBeNull();

    expect(Number(timeout![1])).toBe(5000);

    /**
     * The headroom, not merely the ordering.
     *
     * `toBeLessThan(5000)` was the first version of this, and review walked
     * through it with `TELEGRAM_TIMEOUT_MS = 4900` — the exact edit someone
     * makes reasoning "we are giving up on Telegram too early". It is under
     * the budget and it loses the race anyway: the isolate has to boot, the
     * cold fetch overshoots its deadline by most of a second, and the reply
     * still has to travel back. Then `pg_net` gives up first, writes neither
     * status nor content, and the outage looks like nothing at all.
     *
     * 2000 ms is what the comment on the constant argues for, so 2000 ms is
     * what is asserted. Moving the constant now means arguing with this.
     */
    expect(Number(timeout![1]) - TELEGRAM_TIMEOUT_MS).toBeGreaterThanOrEqual(
      2000,
    );
  });
});

describe("index.ts", () => {
  /**
   * The entrypoint is the one file nothing checks, so the only thing worth
   * guaranteeing about it is that it stays empty of anything worth checking.
   * Every defect in #272 lived here; none of them could have lived in three
   * lines of wiring.
   */
  const code = readFileSync(
    join(process.cwd(), "supabase", "functions", "feedback-telegram", "index.ts"),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // `[^:]` matters: an unguarded `\/\/.*$` reads the `//` of a URL as a
    // comment. There is no URL in this file today — the guard is so that stays
    // a property of the check rather than a coincidence of the file.
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ")
    .trim();

  /**
   * Pinned whole, not described.
   *
   * The first version of this listed properties instead — no `if`, no `for`,
   * `Deno.` exactly twice — and review walked straight through it with
   * `Deno.env.get(name) ?? "dev-secret"`, the kind of thing someone leaves
   * behind after an afternoon of local debugging. It has no banned keyword and
   * it does not change the count of anything, and it hands a hardcoded
   * fallback to the one check keeping this endpoint off the open internet.
   *
   * There is no set of properties that catches that and stays readable. The
   * file is three lines whose entire contract is to remain three lines, so the
   * three lines are the assertion.
   *
   * Be clear about the limit of that: it stops this file drifting unnoticed,
   * and nothing more. Anyone changing `index.ts` must edit this string in the
   * same commit, so a bad change arrives as one line of source beside one
   * matching line of test — small, tidy, and easy to wave through. This buys
   * the change a reviewer's attention; it does not substitute for one.
   */
  it("is exactly the wiring, to the character", () => {
    expect(code).toBe(
      'import "jsr:@supabase/functions-js/edge-runtime.d.ts"; ' +
        'import { handleRequest } from "./handler.ts"; ' +
        "Deno.serve((req) => handleRequest(req, { " +
        "getSecret: (name) => Deno.env.get(name), " +
        "fetch: (input, init) => globalThis.fetch(input, init), " +
        "}) );",
    );
  });
});
