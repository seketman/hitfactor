import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * The Supabase-provided objects the migrations lean on, recreated well enough
 * for those migrations to apply to a plain Postgres.
 *
 * `auth`, `storage`, `net`, `supabase_functions` and `cron` belong to the
 * platform and to its extensions — none of them exist in a bare database. The
 * migrations reference them heavily — nearly every RLS predicate is written
 * against `auth.uid()`, 0020 writes storage policies, and 0025-0027 read the
 * webhook plumbing — so without these a migration cannot even be applied to a
 * real engine. (A count would have gone here; it would have rotted with the
 * next migration, which is the same trap this whole test exists to close.)
 *
 * **What this buys and what it costs.** It lets the test suite run every
 * migration against a genuine Postgres, with no credentials, no network and no
 * Docker — which is what makes `database-types-drift.test.ts` possible at all.
 * What it cannot do is verify the platform: if Supabase changes the shape of
 * `supabase_functions.hooks`, this stub keeps agreeing with the migrations and
 * both are wrong together. Columns here are taken from the published
 * definitions, and the stub is deliberately the smallest thing the migrations
 * actually touch.
 *
 * `public` is left empty on purpose. Everything in it comes from the
 * migrations, which is the whole point of the drift test; a test that needs a
 * stand-in for one of its tables builds that itself.
 */
export const PLATFORM_SQL = `
  -- Auth. auth.uid() is what every RLS policy is written against.
  create schema if not exists auth;
  create table auth.users (
    id    uuid primary key default gen_random_uuid(),
    email text
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select '{}'::jsonb $$;

  -- Storage. 0020 creates the import bucket and its per-user policies.
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key, name text, owner uuid, owner_id text,
    public boolean default false, avif_autodetection boolean default false,
    file_size_limit bigint, allowed_mime_types text[],
    created_at timestamptz default now(), updated_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id),
    name text, owner uuid, owner_id text, metadata jsonb,
    created_at timestamptz default now(), updated_at timestamptz default now()
  );
  create function storage.foldername(text) returns text[] language sql immutable as
    $$ select string_to_array($1, '/') $$;

  -- pg_net, from its published schema.
  create schema if not exists net;
  create table net._http_response (
    id            bigint primary key,
    status_code   integer,
    content_type  text,
    headers       jsonb,
    content       text,
    timed_out     boolean,
    error_msg     text,
    created       timestamptz not null default now()
  );

  -- Database Webhooks, from docker/volumes/db/webhooks.sql.
  create schema if not exists supabase_functions;
  create table supabase_functions.hooks (
    id             bigserial primary key,
    hook_table_id  integer     not null,
    hook_name      text        not null,
    created_at     timestamptz not null default now(),
    request_id     bigint
  );
  -- Records nothing: the trigger 0025 installs only has to exist and fire.
  -- Tests that care what a delivery looked like write the hooks row directly.
  create function supabase_functions.http_request() returns trigger
    language plpgsql as $$ begin return new; end $$;

  -- pg_cron. The stubs record their calls so a test can assert scheduling,
  -- and the exact signature matters: 0026 looks for
  -- cron.schedule(text,text,text) by arity, so a stub with the wrong one
  -- fails that migration here instead of passing quietly.
  create schema if not exists cron;
  create table cron.job (
    jobid bigserial primary key, jobname text, schedule text, command text
  );
  create function cron.schedule(job_name text, schedule text, command text)
    returns bigint language sql as
    $$ insert into cron.job (jobname, schedule, command)
       values (job_name, schedule, command) returning jobid $$;
  create function cron.unschedule(job_name text) returns boolean language sql as
    $$ delete from cron.job where jobname = job_name returning true $$;

  -- The roles the migrations grant and revoke against.
  create role anon;
  create role authenticated;
  create role service_role;
`;

export const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

/** Every migration, in the order `docs/development.md` says to apply them. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * A Postgres with the platform stubs in place and nothing in `public`.
 *
 * `extraSql` runs straight after, for a caller that needs a stand-in of its
 * own — a table a migration would otherwise create, say. It exists so that
 * building one of these stays a single line at every call site.
 */
export async function createPlatform(extraSql = ""): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(PLATFORM_SQL);
  if (extraSql) await db.exec(extraSql);
  return db;
}

/**
 * A Postgres carrying the schema the migrations produce, applied in order.
 *
 * 0025 reads two session settings and aborts without them — see its header.
 * The values are inert here: nothing in the tests calls the webhook, and the
 * secret only ever reaches a trigger definition in this throwaway database.
 */
export async function createSchemaFromMigrations(): Promise<PGlite> {
  const db = await createPlatform();
  await db.exec(`
    select set_config('hitfactor.functions_base_url',
                      'https://stub.supabase.co/functions/v1', false);
    select set_config('hitfactor.feedback_webhook_secret', 'stub-secret', false);
  `);
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (error) {
      throw new Error(
        `${file} did not apply to a plain Postgres: ${(error as Error).message}\n` +
          "If it needs a platform object this stub lacks, add it to PLATFORM_SQL.",
      );
    }
  }
  return db;
}
