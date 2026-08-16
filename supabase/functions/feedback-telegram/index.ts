// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleRequest } from "./handler.ts";

/**
 * The entrypoint, and deliberately nothing else.
 *
 * This is the one part of the function whose *behaviour* nothing verifies.
 * ESLint ignores the directory for being Deno; `tsc` never reaches this file
 * because nothing type-checked imports it; and vitest cannot import a module
 * that calls `Deno.serve` on load. #272 was a defect in this file, and it
 * survived to production because reading it was the only review available.
 *
 * So there is as little here as there can be: the two capabilities only Deno
 * supplies, handed to a handler that vitest drives directly. What does guard
 * this file is `feedback-telegram-handler.test.ts`, which asserts its source
 * character for character — a shape check, not a behavioural one, and the
 * reason it is that blunt is that a list of forbidden keywords let
 * `Deno.env.get(name) ?? "dev-secret"` straight through.
 *
 * Anything added below is code nothing will check. Put it in `handler.ts`.
 */
Deno.serve((req) =>
  handleRequest(req, {
    getSecret: (name) => Deno.env.get(name),
    fetch: (input, init) => globalThis.fetch(input, init),
  })
);
