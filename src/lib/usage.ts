/**
 * Monthly usage tracking.
 *
 * One row per (user_id, month). getOrCreateUsage returns the current month's
 * count so /api/check can compare against the plan's quota BEFORE incurring
 * any Anthropic cost. incrementUsage runs after a successful evaluation.
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

export async function incrementUsage(userId: string): Promise<number> {
  const db = getDb();
  const month = currentMonth();

  // Upsert: insert count=1 if no row for this month, else atomically +1.
  // ON CONFLICT matches the (user_id, month) unique index.
  const [row] = await db
    .insert(schema.usage)
    .values({ userId, month, count: 1 })
    .onConflictDoUpdate({
      target: [schema.usage.userId, schema.usage.month],
      set: {
        count: sql`${schema.usage.count} + 1`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ count: schema.usage.count });

  return row.count;
}
