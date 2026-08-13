import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ThemeProvider,
  themeScriptProps,
} from "@/components/providers/ThemeProvider";

/**
 * The theme script `next-themes` injects must keep executing on the server
 * render, and must not make React warn on the client one. Those two pull in
 * opposite directions, and the compromise lives in a single boolean.
 *
 * It is worth a test because the failure is silent in both directions:
 *
 *  - drop the `typeof window` split and always send the `type`, and the
 *    server-rendered script stops executing. The page renders, every test
 *    passes, the build passes — and the wrong theme flashes on every cold
 *    load. In development, with the preference already in `localStorage` and
 *    matching the OS, you can go a long time without seeing it.
 *  - drop `scriptProps` altogether and the console warning comes back, which
 *    nothing else in the suite would notice.
 *
 * See the comment on `themeScriptProps` for why this is the only lever.
 *
 * ## What this does NOT cover
 *
 * That the warning is actually gone. Proving that needs a real client render
 * with a spied `console.error`, and the whole suite runs under
 * `environment: "node"` (`vitest.config.ts`) — no DOM, and `next-themes`
 * would additionally need a `matchMedia` stub. Pulling in `jsdom` for the
 * repo's only browser-environment test was judged too much weight for a
 * dev-only console message.
 *
 * So the tests below assert the *inputs* to React's rule, not its output: the
 * server gets no `type`, and the client gets one React exempts. If React ever
 * changes that rule, this suite stays green and the warning returns quietly.
 * That is the known gap, and it is why the rule is written out in full here
 * rather than left as "application/json, because it works".
 */

describe("theme script props", () => {
  it("sends no type on the server, so the browser runs the script", () => {
    expect(themeScriptProps(false)).toBeUndefined();
  });

  it("sends an inert type on the client, so React does not warn", () => {
    expect(themeScriptProps(true)).toEqual({ type: "application/json" });
  });

  /**
   * Not a behavioural test — it restates the requirement the literal above has
   * to satisfy, so that changing the literal without understanding it fails
   * here instead of in someone's console.
   *
   * The tempting wrong edit is making the type *honest*: a theme script really
   * is JavaScript, so `text/javascript` looks like the correct value. It is
   * the one class of value that brings the warning straight back. React skips
   * the warning for every `type` **except** the JavaScript MIME types
   * (`isScriptDataBlock`), so that is what gets asserted.
   *
   * List copied verbatim from `isScriptDataBlock` in
   * `node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js`.
   */
  it("the client type is none of the values React warns about", () => {
    const WARNS_IN_REACT = [
      "module",
      "importmap",
      "speculationrules",
      "application/ecmascript",
      "application/javascript",
      "application/x-ecmascript",
      "application/x-javascript",
      "text/ecmascript",
      "text/javascript",
      "text/javascript1.0",
      "text/javascript1.1",
      "text/javascript1.2",
      "text/javascript1.3",
      "text/javascript1.4",
      "text/javascript1.5",
      "text/jscript",
      "text/livescript",
      "text/x-ecmascript",
      "text/x-javascript",
    ];

    const type = themeScriptProps(true)?.type;
    expect(typeof type).toBe("string");
    expect(type).not.toBe("");
    expect(WARNS_IN_REACT).not.toContain(type?.toLowerCase());
  });
});

describe("ThemeProvider server render", () => {
  /**
   * The suite runs under `environment: "node"`, so this goes down the same
   * branch a real server render takes.
   */
  let html = "";

  beforeAll(() => {
    html = renderToStaticMarkup(
      createElement(ThemeProvider, null, createElement("div", null, "x")),
    );
  });

  /**
   * Picked by content rather than by position. Taking the first `<script>` in
   * the markup would keep passing while silently checking the wrong node the
   * day anything else renders a script above this one.
   */
  function themeScript() {
    const scripts = [
      ...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g),
    ].filter(([, , body]) => body?.includes("localStorage"));
    expect(scripts).toHaveLength(1);
    return scripts[0]!;
  }

  it("emits the blocking theme script", () => {
    const [, , body] = themeScript();
    expect(body).toContain("localStorage");
    expect(body).toContain("matchMedia");
  });

  it("emits it with no type attribute, so the browser executes it", () => {
    const [, attributes] = themeScript();
    expect(attributes).not.toMatch(/\btype=/);
  });

  it("still renders its children", () => {
    expect(html).toContain("<div>x</div>");
  });
});
