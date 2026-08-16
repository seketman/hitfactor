import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { localeAlternates, routing } from "@/i18n/routing";
import es from "../messages/es.json";
import en from "../messages/en.json";

/**
 * `next-intl/server` resolves to its client build under vitest — the
 * `react-server` export condition is a Next thing, not a Node one — and
 * `getTranslations` then throws "not supported in Client Components".
 * Flipping the condition globally in `vitest.config.ts` would change module
 * resolution for every other test, which is a large blast radius for one
 * file.
 *
 * So it is doubled here, and the double reads the **real catalogues**. What
 * is under test is the route's composition — which key it asks for, for
 * which locale, and what it builds around the answer — not next-intl's
 * ability to look a string up. A double returning `"lorem"` would pass just
 * as well while the route served a hardcoded description; reading the actual
 * JSON keeps the assertion honest.
 */
vi.mock("next-intl/server", async () => {
  // `Record<string, unknown>` per namespace, not `Record<string, string>`:
  // several namespaces nest (`auth.login.title`), so the narrower type does
  // not describe the catalogue and the build's type check rejects it — a
  // failure `npm test` does not surface, since vitest does not type check.
  const catalogues: Record<string, Record<string, unknown>> = {
    es: (await import("../messages/es.json")).default,
    en: (await import("../messages/en.json")).default,
  };
  return {
    getTranslations: async ({
      locale,
      namespace,
    }: {
      locale: string;
      namespace: string;
    }) => {
      const messages = catalogues[locale]?.[namespace] as
        | Record<string, string>
        | undefined;
      return (key: string) => {
        // Throws rather than returning "", because that is what production
        // does. A forgiving double makes a key deleted from *both*
        // catalogues — which `messages-parity` cannot see, since it only
        // compares locales against each other — pass here while the real
        // route 500s.
        const message = messages?.[key];
        if (message === undefined) {
          throw new Error(`MISSING_MESSAGE: ${namespace}.${key}`);
        }
        return message;
      };
    },
  };
});

const { GET, generateStaticParams } = await import(
  "@/app/[locale]/manifest.webmanifest/route"
);

/**
 * The per-locale web app manifest (#275).
 *
 * It is a hand-written Route Handler rather than Next's `manifest.ts` file
 * convention, because that convention only exists at the root of `app`. That
 * trade is what this file guards: everything the framework used to supply
 * now has to be supplied here, and nothing else notices when it is not.
 *
 * Two of those things were missing when this route was first written, and
 * neither the build, the type-check nor the rest of the suite objected:
 *
 *  - **The locale was never validated.** `[locale]/layout.tsx` does the
 *    `notFound()`, but Route Handlers are not wrapped by the segment layout,
 *    and the proxy matcher in `src/proxy.ts` skips every path with a dot —
 *    which is every URL this route answers. `/anything/manifest.webmanifest`
 *    returned 200 with the Spanish manifest.
 *  - **`Cache-Control` was dropped.** Next's own manifest codegen sends
 *    `public, max-age=0, must-revalidate`; a hand-rolled route inherits
 *    whatever the CDN feels like instead.
 *
 * Both were found by requesting the URL, not by reading the code — the same
 * lesson `tests/proxy-matcher.test.ts` records about `/api/health`.
 */

const CATALOGUES = { es, en } as const;

async function fetchManifest(locale: string) {
  const response = await GET(new Request(`https://example.test/${locale}/manifest.webmanifest`), {
    params: Promise.resolve({ locale }),
  });
  return response;
}

describe("per-locale web app manifest", () => {
  it("declares every routed locale as a static param (sanity check)", () => {
    expect(generateStaticParams().map((p) => p.locale).sort()).toEqual(
      [...routing.locales].sort(),
    );
  });

  it.each(routing.locales)("%s serves its own description and start_url", async (locale) => {
    const response = await fetchManifest(locale);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/manifest+json",
    );

    const body = await response.json();
    // Read from the catalogue rather than repeated here: a literal would
    // just be a second place to update, and would pass while the route
    // served a hardcoded string.
    expect(body.description).toBe(
      CATALOGUES[locale as keyof typeof CATALOGUES].meta.manifestDescription,
    );
    // Installing from a locale opens the app in it, rather than sending the
    // user back through detection.
    expect(body.start_url).toBe(`/${locale}`);
  });

  it("gives every locale a different description (sanity check)", async () => {
    const descriptions = await Promise.all(
      routing.locales.map(async (l) => (await (await fetchManifest(l)).json()).description),
    );
    expect(new Set(descriptions).size).toBe(routing.locales.length);
  });

  it.each(["xx", "zzz", "es-AR", "..", "en-US", "ES", "es-ES", ""])(
    "404s on %s instead of falling back to the default locale",
    async (locale) => {
      const response = await fetchManifest(locale);
      expect(
        response.status,
        `${locale} is not a routed locale, so this URL must not exist. ` +
          `Falling back would answer 200 with the default catalogue for any ` +
          `string in the path, from a route nothing else validates.`,
      ).toBe(404);
    },
  );

  it("keeps the Cache-Control the file convention used to send", async () => {
    const response = await fetchManifest(routing.defaultLocale);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
  });
});

/**
 * The bug that moving the OG image exposed: `[locale]/page.tsx` declared
 * `openGraph.images` by hand, pointing at `/opengraph-image`. A hand-written
 * URL overrides the file convention, so the generated image was never the
 * one being advertised — and when the file moved, the URL stayed behind and
 * served a 404 on every share.
 *
 * Nothing else catches this. The build is happy, the type is valid, and the
 * tag renders; it is only wrong against a route that exists somewhere else.
 * So it is checked the way this repo checks that class of thing — against
 * the source, like `no-host-header-urls` and `no-raw-errors-to-user`.
 */
describe("metadata never hand-writes a generated image URL", () => {
  const APP = join(process.cwd(), "src", "app");

  function metadataSources(dir = APP, prefix = ""): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) out.push(...metadataSources(join(dir, entry.name), rel));
      else if (/\.tsx?$/.test(entry.name)) out.push(rel);
    }
    return out.sort();
  }

  /** `"…/opengraph-image…"` or `"…/twitter-image…"` inside a string literal. */
  const HARDCODED = /"[^"]*\/(?:opengraph|twitter)-image[^"]*"/;

  function code(file: string): string {
    return readFileSync(join(APP, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, (b) => b.replace(/[^\n]/g, " "))
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  it("finds sources to scan (sanity check)", () => {
    const files = metadataSources();
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain("[locale]/page.tsx");
  });

  it("no source points at a metadata image route by string", () => {
    const offenders = metadataSources().filter((f) => HARDCODED.test(code(f)));
    expect(
      offenders,
      `These name a generated image route in a string literal. Written into ` +
        `\`openGraph.images\` or \`twitter.images\` it overrides the ` +
        `\`opengraph-image\` file convention, and the URL then rots the ` +
        `moment the file moves — silently, because the tag still renders. ` +
        `Delete the field and let the convention emit it.`,
    ).toEqual([]);
  });
});

describe("localeAlternates", () => {
  it("covers every routed locale", () => {
    expect(Object.keys(localeAlternates()).sort()).toEqual(
      [...routing.locales].sort(),
    );
  });

  it("builds locale-prefixed paths", () => {
    expect(localeAlternates()[routing.defaultLocale]).toBe(
      `/${routing.defaultLocale}`,
    );
    expect(localeAlternates("/about")[routing.defaultLocale]).toBe(
      `/${routing.defaultLocale}/about`,
    );
  });
});
