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
 * Atomically reserve one evaluation slot for (userId, current month).
 *
 * Returns { granted: true, count } with the new count if the user had
 * room. Returns { granted: false, count } with the current count if the
 * user was already at or above the quota — the caller should return 402
 * without touching the engine.
 *
 * Implementation uses a single upsert with a `WHERE count < quota`
 * guard on the update branch. If the guard rejects (count already at
 * the cap) the query returns zero rows; we then read the latest count
 * so the 402 response can include the current usage.
 */
export async function claimQuotaSlot(
  userId: string,
  quota: number,
): Promise<ClaimResult> {
  const db = getDb();
  const month = currentMonth();

  // Two-step only when the atomic branch rejects (fast-path hits DB once).
  const rows = await db
    .insert(schema.usage)
    .values({ userId, month, count: 1 })
    .onConflictDoUpdate({
      target: [schema.usage.userId, schema.usage.month],
      set: {
        count: sql`${schema.usage.count} + 1`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${schema.usage.count} < ${quota}`,
    })
    .returning({ count: schema.usage.count });

  if (rows.length === 1) {
    return { granted: true, count: rows[0].count };
  }

  // No rows returned → the guard rejected. Read the current count so the
  // 402 response can render "X of Y this month" accurately.
  const current = await getCurrentUsage(userId);
  return { granted: false, count: current };
}
