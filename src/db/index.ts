import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { requireEnv } from "@/lib/require-env";
import * as schema from "./schema";

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * RLS contract (audit D1).
 *
 * Every table calls `.enableRLS()` in `schema.ts` for defense-in-depth.
 * No policies are defined — the app uses Supabase's `postgres` role,
 * which has BYPASSRLS, so queries succeed by bypassing the (empty)
 * policy set. If a future maintainer points DATABASE_URL at a non-
 * superuser role (e.g., the `anon` or `authenticated` roles a
 * PostgREST endpoint would use), every read/write returns zero rows
 * silently — RLS-enabled tables with no policies deny everything.
 *
 * The mitigation is a `vercel env` discipline + this comment. Adding
 * a startup assertion that issues `SELECT current_user` would catch
 * the mistake at boot, but it'd also add a probe RTT to every cold
 * start and isn't worth the cost when the deploy pipeline is the
 * place to enforce env hygiene. If RLS policies are added later, drop
 * this contract note.
 */

export function getDb() {
  if (_db) return _db;

  const url = requireEnv("DATABASE_URL");
  _client = postgres(url, {
    // Vercel runs this in a Lambda. postgres.js defaults `max` to 10,
    // so a single Lambda would open up to 10 connections to Supabase
    // — and Supabase's session-mode pooler caps at 15 total. The
    // dashboard render fires ~10 concurrent Drizzle queries via
    // Promise.all, each grabbing its own connection from the postgres
    // .js pool, so ONE Lambda invocation can exhaust the entire
    // Supabase pool. Result: intermittent
    //   `EMAXCONNSESSION max clients reached in session mode - max
    //    clients are limited to pool_size: 15`
    // and Server-Component render failures observed all afternoon.
    //
    // `max: 1` makes each Lambda hold at most one connection. Queries
    // within the same Lambda serialize through that single connection
    // — microsecond-scale serialization, well below any Postgres
    // round-trip. Multiple concurrent Lambdas now each take 1 slot
    // instead of 10, so the same 15-slot pool comfortably serves
    // 15 simultaneous renders.
    //
    // `idle_timeout: 20` (seconds) lets the connection close quickly
    // when a Lambda goes idle, returning the slot to the pool faster
    // than the default keepalive.
    //
    // Production-grade move beyond this: switch DATABASE_URL to
    // Supabase's transaction-mode pooler (port 6543). That's a Vercel
    // env change and requires `prepare: false` (already set), so the
    // upgrade path is just a URL flip when needed.
    max: 1,
    idle_timeout: 20,
    prepare: false,
  });
  _db = drizzle(_client, { schema });
  return _db;
}

export type Db = ReturnType<typeof getDb>;

// The Drizzle transaction client (passed to `db.transaction(async (tx) =>
// ...)`) is structurally distinct from the top-level Db — it omits
// `$client` and a few other base-class fields. Helpers that accept
// "either a db or a tx" should type their parameter as `DbOrTx`. The
// transaction callback's `tx` argument is captured via Parameters<>
// without naming the underlying Drizzle generic, which keeps this
// alias resilient to Drizzle major-version type shape changes.
export type Tx = Parameters<NonNullable<Parameters<Db["transaction"]>[0]>>[0];
export type DbOrTx = Db | Tx;

export { schema };
