/**
 * Sidebar counts for the /admin layout's left rail.
 *
 * Three numbers surfaced as inline badges on the rail's MODEL group
 * so the founder sees what needs eyes without opening anything:
 *
 *   - todayQueue       — recent review_recommended cases in nuanced
 *                        subtypes (standards_conflict +
 *                        ensemble_disagreement + novel_pattern), the
 *                        cases worth a 15-minute daily review.
 *   - overrideInbox    — open rows in /admin/overrides (the
 *                        customer-disagree triage stream).
 *   - customerFlags    — placeholder. The customer_flagged_reviews
 *                        table doesn't exist yet; this returns 0
 *                        until the surface ships.
 *
 * Loaded once per /admin/* page render via the layout. Cheap at
 * <100 users; revisit if cardinality grows.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

const DAY_MS = 24 * 60 * 60 * 1000;
const TODAY_WINDOW_DAYS = 7;

// The nuanced subtypes — the cases that need discernment, not the
// trailing-period-on-a-heading kind. Mirrors the daily-review focus
// described in the design: cases that improve the model when adjudicated.
const NUANCED_SUBTYPES = [
  "standards_conflict",
  "ensemble_disagreement",
  "novel_pattern",
] as const;

export interface SidebarCounts {
  todayQueue: number;
  overrideInbox: number;
  customerFlags: number;
}

export async function loadSidebarCounts(): Promise<SidebarCounts> {
  const db = getDb();
  const since = new Date(Date.now() - TODAY_WINDOW_DAYS * DAY_MS).toISOString();

  const [queueRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.violations)
    .where(
      and(
        inArray(
          schema.violations.reviewReasonSubtype,
          NUANCED_SUBTYPES as unknown as string[],
        ),
        sql`${schema.violations.createdAt} >= ${since}`,
      ),
    );

  const [overrideRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.violationOverrides)
    .where(eq(schema.violationOverrides.overrideStatus, "open"));

  return {
    todayQueue: Number(queueRow?.count ?? 0),
    overrideInbox: Number(overrideRow?.count ?? 0),
    customerFlags: 0,
  };
}
