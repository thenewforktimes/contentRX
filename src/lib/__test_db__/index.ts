/**
 * pglite-backed test DB harness.
 *
 * Builds an in-process Postgres (via @electric-sql/pglite) and wires
 * Drizzle on top of it so route-level + DB-mocked tests can run
 * against real Postgres semantics without a daemon. Schema is
 * bootstrapped from `setup.sql` — a hand-written subset of
 * `src/db/schema.ts`.
 *
 * Usage:
 *
 *   import { createTestDb } from "@/lib/__test_db__";
 *
 *   const harness = await createTestDb();
 *   // …mock @/db so the production code under test reads
 *   //   getDb() → harness.db
 *   await harness.close();
 *
 * Why a dedicated harness vs a global setup file: each test gets a
 * pristine pglite instance. Concurrent tests don't share state, and
 * a hung test can't poison the next one.
 *
 * Why pglite vs a docker container: 0-config, runs in vitest's node
 * env, fast (~50ms cold-start). Real Postgres for the SQL semantics
 * we actually depend on (ON CONFLICT … DO UPDATE … WHERE, partial
 * unique indexes, transactions).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SETUP_SQL_PATH = path.join(HARNESS_DIR, "setup.sql");

export interface TestDbHarness {
  /** The Drizzle handle. Pass this to code under test by mocking
   * `getDb()` to return it. */
  db: PgliteDatabase<typeof schema>;
  /** Raw pglite client. Use sparingly — Drizzle is the surface for
   * production code, so prefer `db` for assertions too. */
  client: PGlite;
  /** Truncate every test-managed table back to empty. Cheap reset
   * between tests in the same suite. */
  reset: () => Promise<void>;
  /** Tear down the in-process Postgres. Call in `afterEach` /
   * `afterAll` so the WASM instance can free its memory. */
  close: () => Promise<void>;
}

let cachedSetupSql: string | null = null;
function loadSetupSql(): string {
  if (cachedSetupSql !== null) return cachedSetupSql;
  cachedSetupSql = fs.readFileSync(SETUP_SQL_PATH, "utf-8");
  return cachedSetupSql;
}

const TABLES_TO_RESET = [
  "violation_overrides",
  "violations",
  "usage_events",
  "usage",
  "subscriptions",
  "users",
] as const;

/** Spin up a fresh pglite instance with the test schema applied.
 *
 * Each call returns an isolated instance — concurrent test files don't
 * share state. */
export async function createTestDb(): Promise<TestDbHarness> {
  const client = new PGlite();
  // Drizzle's pglite adapter expects a client that implements the
  // PGlite API. Pass our schema so query.<table> typed accessors work.
  const db = drizzle(client, { schema }) as PgliteDatabase<typeof schema>;

  // Apply the SQL bootstrap as a single batch. pglite's `exec` runs
  // a multi-statement string without prepared-statement parsing.
  await client.exec(loadSetupSql());

  return {
    db,
    client,
    reset: async () => {
      // CASCADE so referenced rows in users/etc. are cleared in one shot.
      // RESTART IDENTITY is moot since we use cuid2 strings for ids.
      await db.execute(
        sql.raw(
          `TRUNCATE TABLE ${TABLES_TO_RESET.join(", ")} CASCADE`,
        ),
      );
    },
    close: async () => {
      await client.close();
    },
  };
}

/** Insert a minimal users row for tests that need `claimQuotaSlot` or
 * any other per-user code path. Returns the inserted id. */
export async function seedUser(
  harness: TestDbHarness,
  partial: Partial<typeof schema.users.$inferInsert> = {},
): Promise<string> {
  const id =
    partial.id ?? `usr_${Math.random().toString(36).slice(2, 10)}`;
  await harness.db.insert(schema.users).values({
    id,
    clerkId: partial.clerkId ?? `clerk_${id}`,
    email: partial.email ?? `${id}@test.local`,
    plan: partial.plan ?? "free",
    teamOwnerUserId: partial.teamOwnerUserId,
    apiKeyHash: partial.apiKeyHash,
    apiKeyPrefix: partial.apiKeyPrefix,
    stripeCustomerId: partial.stripeCustomerId,
  });
  return id;
}
