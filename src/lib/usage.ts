/**
 * Monthly usage tracking.
 *
 * One row per (user_id, month). `claimQuotaSlot` is the single atomic
 * operation /api/check uses on the hot path: it either reserves one
 * slot below the user's quota or returns null if they're at the cap.
 * No separate "read then write" step, so a burst of concurrent requests
 * can't squeeze past the limit (closes BE-M-04 / Known Limitation #2).
 *
 * getCurrentUsage stays as a read-only helper for the dashboard — it
 * never claims slots, just reports.
 */

import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { currentMonth } from "./quotas";

export async function getCurrentUsage(userId: string): Promise<number> {
  const db = getDb();
  const month = currentMonth();

  const [row] = await db
    .select({ count: schema.usage.count })
    .from(schema.usage)
    .where(
      and(eq(schema.usage.userId, userId), eq(schema.usage.month, month)),
    )
    .limit(1);

  return row?.count ?? 0;
}

export type ClaimResult =
  | { granted: true; count: number }
  | { granted: false; count: number };

/**
 * Atomically reserve N evaluation slots for (userId, current month).
 *
 * Returns { granted: true, count } with the new count if the user had
 * room for all N. Returns { granted: false, count } with the current
 * count if the claim would have pushed them over the quota — the caller
 * should return 402 without touching the engine. The check is
 * all-or-nothing: a request that needs 3 checks against a 1-remaining
 * user is denied entirely, never partially fulfilled.
 *
 * `n` defaults to 1 to match the original `claimQuotaSlot` contract.
 * The proportional-billing path (a single /api/check call charges
 * Math.ceil(text.length / 5000) slots, see route.ts) passes n > 1 when
 * the input text spans multiple billing tiers.
 *
 * Implementation: same upsert + setWhere guard pattern as the
 * single-slot version, but the guard becomes `count + n <= quota` and
 * the increment becomes `count + n`. The atomic property is preserved
 * — the entire claim either succeeds or rolls back.
 */
export async function claimQuotaSlots(
  userId: string,
  n: number,
  quota: number,
): Promise<ClaimResult> {
  // Defensive: a callsite that computed n=0 (e.g., empty text post-trim)
  // should never reach the API gate, but if it does, treat as a free
  // pass that doesn't increment. The caller's fall-through behavior
  // matches the granted=true contract; count stays accurate.
  if (n <= 0) {
    const current = await getCurrentUsage(userId);
    return { granted: true, count: current };
  }

  const db = getDb();
  const month = currentMonth();

  const rows = await db
    .insert(schema.usage)
    .values({ userId, month, count: n })
    .onConflictDoUpdate({
      target: [schema.usage.userId, schema.usage.month],
      set: {
        count: sql`${schema.usage.count} + ${n}`,
        updatedAt: sql`now()`,
      },
      // All-or-nothing: only commit the +n increment if the user has
      // room for the full claim. Partial fulfillment is not supported.
      setWhere: sql`${schema.usage.count} + ${n} <= ${quota}`,
    })
    .returning({ count: schema.usage.count });

  if (rows.length === 1) {
    return { granted: true, count: rows[0].count };
  }

  // Guard rejected. Read the current count for the 402 response.
  const current = await getCurrentUsage(userId);
  return { granted: false, count: current };
}

/**
 * Backward-compat single-slot wrapper. Same semantics as the original
 * `claimQuotaSlot` for the rest of the codebase that hasn't migrated
 * to the multi-slot form.
 */
export async function claimQuotaSlot(
  userId: string,
  quota: number,
): Promise<ClaimResult> {
  return claimQuotaSlots(userId, 1, quota);
}

export type TokenIncrement = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
};

/**
 * Add the token counts from a single /api/check evaluation to the
 * user's current-month usage row. Closes audit M-24 (token-cost
 * telemetry per customer).
 *
 * Idempotency: this is intentionally NOT idempotent — every successful
 * eval should add to the running total. /api/check's quota check
 * (claimQuotaSlot) already gates the per-month call count at 1
 * increment per request, so calling this once after a granted slot
 * matches the same lifecycle.
 *
 * The row is guaranteed to exist by the time this is called: the
 * caller's flow is (claimQuotaSlot which inserts/upserts) → engine
 * call → recordTokenUsage. If the row somehow doesn't exist (manual
 * delete?), the upsert here still creates it with count=0 + the new
 * tokens, so we never lose telemetry.
 */
export async function recordTokenUsage(
  userId: string,
  tokens: TokenIncrement,
): Promise<void> {
  const db = getDb();
  const month = currentMonth();
  const inputT = Math.max(0, Math.floor(tokens.inputTokens));
  const outputT = Math.max(0, Math.floor(tokens.outputTokens));
  const cacheReadT = Math.max(0, Math.floor(tokens.cacheReadInputTokens ?? 0));
  const cacheCreateT = Math.max(0, Math.floor(tokens.cacheCreationInputTokens ?? 0));

  await db
    .insert(schema.usage)
    .values({
      userId,
      month,
      // count stays at 0 here — claimQuotaSlot is the call counter.
      // recordTokenUsage only adds to the token aggregates.
      count: 0,
      inputTokens: inputT,
      outputTokens: outputT,
      cacheReadInputTokens: cacheReadT,
      cacheCreationInputTokens: cacheCreateT,
    })
    .onConflictDoUpdate({
      target: [schema.usage.userId, schema.usage.month],
      set: {
        inputTokens: sql`${schema.usage.inputTokens} + ${inputT}`,
        outputTokens: sql`${schema.usage.outputTokens} + ${outputT}`,
        cacheReadInputTokens: sql`${schema.usage.cacheReadInputTokens} + ${cacheReadT}`,
        cacheCreationInputTokens: sql`${schema.usage.cacheCreationInputTokens} + ${cacheCreateT}`,
        updatedAt: sql`now()`,
      },
    });
}
