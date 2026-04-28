/**
 * Health-check helpers for /status and /api/status.
 *
 * Each check probes one piece of infrastructure (DB, Redis), times the
 * round-trip, and returns a typed result. Callers compose them; the
 * helpers themselves never throw — a connection blow-up shows up as
 * `{ ok: false, error: "..." }` so the status surface degrades
 * gracefully rather than 500-ing.
 *
 * Pre-launch the engine evaluator isn't probed directly (it would cost
 * an LLM call per check), so its health is implicit: `/api/check` going
 * through tells us the engine's reachable. A future cron could probe
 * the engine on a schedule and write the result to Redis for /status
 * to read cheaply, but that's overkill at current traffic.
 */

import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getRedis } from "@/lib/redis";

const PROBE_TIMEOUT_MS = 2000;

export type CheckResult = {
  ok: boolean;
  latencyMs: number;
  error?: string;
};

export type StatusReport = {
  ok: boolean;
  generatedAt: string;
  checks: {
    db: CheckResult;
    redis: CheckResult;
  };
};

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function timed(probe: () => Promise<unknown>): Promise<CheckResult> {
  const started = Date.now();
  try {
    await withTimeout(probe(), PROBE_TIMEOUT_MS, "probe");
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function checkDb(): Promise<CheckResult> {
  return timed(async () => {
    const db = getDb();
    // SELECT 1 is the cheapest possible round-trip — verifies the
    // connection is open and the DB is responding without touching
    // any application table.
    await db.execute(sql`SELECT 1`);
  });
}

export async function checkRedis(): Promise<CheckResult> {
  return timed(async () => {
    const redis = getRedis();
    await redis.ping();
  });
}

export async function gatherStatus(): Promise<StatusReport> {
  const [db, redis] = await Promise.all([checkDb(), checkRedis()]);
  return {
    ok: db.ok && redis.ok,
    generatedAt: new Date().toISOString(),
    checks: { db, redis },
  };
}
