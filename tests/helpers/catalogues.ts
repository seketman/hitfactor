import { readFileSync } from "node:fs";
import { join } from "node:path";
import { routing } from "@/i18n/routing";

/**
 * Every routed locale's catalogue, read off disk.
 *
 * Guardrails over `messages/` kept doing `import es from "../messages/es.json"`
 * plus a hardcoded `{ es, en }` beside it, which is precisely what made them
 * blind to a third locale (#279): a `pt-BR.json` holding `{}` passed every
 * check while the app served no Portuguese. Deriving the list from `routing`
 * is the fix, and it belongs in one place — the same block had been copied
 * into three test files before it landed here.
 *
 * Returned as `unknown` values: callers narrow to whatever shape they need.
 * The catalogue nests irregularly (`auth.login.title`), so any single concrete
 * type would be a lie that the build's type check rejects.
 */
export function loadCatalogues(): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    routing.locales.map((locale) => [
      locale,
      JSON.parse(
        readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8"),
      ) as Record<string, unknown>,
    ]),
  );
}
