import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * ESLint (#204).
 *
 * The project ran with no static analysis at all until now: no ESLint, no
 * formatter, no `lint` script, no lint step in CI. The code held up
 * anyway — `strict: true`, no `any`, no `@ts-ignore` — which is precisely
 * why the floor is worth having. A full code audit turned up a batch of
 * findings a linter would have caught for free: unused parameters, props
 * a component was handed and never read, a dead exported module, effects
 * with implicit dependencies.
 *
 * Flat config with the ESLint CLI, not `next lint`: Next 16 removed that
 * command, along with the `eslint` key in `next.config.ts`.
 *
 * No Prettier here. Adding it means reformatting 135 files in one commit
 * — a diff that changes no behaviour and that nobody can review
 * carefully, which is the same trade this repo already declined for the
 * bulk comment translation (#215). If formatting is wanted it deserves
 * its own decision and its own PR.
 */
export default defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    rules: {
      /**
       * The audit findings this was installed to catch, promoted to
       * errors so CI blocks on them rather than printing a warning
       * nobody reads.
       */

      // Unused parameters are the shape that actually showed up here:
      // `_filename` threaded through `importStages` and never read. The
      // leading-underscore escape hatch stays, so deliberately unused
      // parameters can say so.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      /**
       * Off, because it was measured rather than assumed.
       *
       * Enabling it produced **136 warnings and zero findings** — almost
       * all of them `arr[0]!` and `regex.exec(s)![1]` in the parsers,
       * where the assertion is idiomatic precisely because
       * `noUncheckedIndexedAccess` is off in `tsconfig.json`. A rule
       * whose output is 100% noise doesn't get triaged, it gets ignored,
       * and it takes the rest of the linter's credibility with it.
       *
       * The honest fix for that class of assertion is
       * `noUncheckedIndexedAccess`, which makes the compiler demand a
       * real check instead of an assertion. That's a tsconfig change with
       * wide fallout and deserves its own decision.
       */
      "@typescript-eslint/no-non-null-assertion": "off",

      /**
       * Downgraded from error, with each hit reviewed one by one. Three
       * remain, all the sanctioned client-only hydration pattern with no
       * better spelling:
       *   - `ThemeToggle` — the `mounted` guard `next-themes` documents.
       *   - `FeedbackForm` — reads `document.referrer`, which doesn't
       *     exist during SSR, so a lazy `useState` initialiser would
       *     render empty on the server and never recover.
       *   - `AppSidebarShell` — resets the mobile drawer on navigation.
       *
       * There was a fourth: `AppSidebarShell` hydrating the collapsed
       * state from localStorage. That one was a real bug (#209) and the
       * rule found it. It is fixed — the state now comes from a cookie
       * the server reads, so there is no effect left to warn about.
       *
       * Keeping the rule at error would mean three disable comments on
       * day one, which is how a linter gets tuned out. As a warning it
       * stayed visible long enough to catch the one hit that mattered.
       */
      "react-hooks/set-state-in-effect": "warn",

      // Warning in the shipped config and stays one: false positives
      // around refs and stable setters.
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  {
    /**
     * Type-aware linting, TypeScript files only.
     *
     * `no-floating-promises` needs the type checker, and the checker
     * needs a project — hence `projectService`. Scoped to `.ts`/`.tsx`
     * because this config file is `.mjs` and isn't in `tsconfig.json`'s
     * `include`, so asking for type info there just errors.
     *
     * It costs a few seconds per run. Worth it: a dropped `await` on a
     * server action fails silently — the redirect never happens, the
     * audit entry never lands, and nothing reports it. That is the exact
     * shape of the bugs this audit kept finding.
     */
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },

  {
    // Tests read fixtures and poke at internals; the strictness that pays
    // off in `src/` mostly produces noise here.
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },

  globalIgnores([
    // Defaults from eslint-config-next, which are replaced rather than
    // merged once `globalIgnores` is declared.
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated from the live schema by `npm run db:types` — linting it
    // would mean editing a file that gets overwritten.
    "src/lib/supabase/database.types.ts",
  ]),
]);
