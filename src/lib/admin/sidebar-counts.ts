/**
 * Sidebar counts for the /admin layout's left rail.
 *
 * Numbers surfaced as inline badges on the rail's groups so the
 * founder sees what needs eyes without opening anything:
 *
 *   - todayQueue       — recent review_recommended cases in nuanced
 *                        subtypes (standards_conflict +
 *                        ensemble_disagreement + novel_pattern), the
 *                        cases worth a 15-minute daily review.
 *   - overrideInbox    — open rows in /admin/overrides (the
 *                        customer-disagree triage stream).
 *   - customerFlags    — open rows in /admin/customer-flags (customer
 *                        explicit flag-for-review queue).
 *   - library          — total active operational signals across the
 *                        whole standards library (overrides + flags +
 *                        suggestion candidates per /admin/model
 *                        mission-control). Lets the founder see
 *                        whether anything in /admin/model needs eyes
 *                        without opening it — silence on the badge =
 *                        no rules above attention threshold.
 *
 * Loaded once per /admin/* page render via the layout. Cheap at
 * <100 users; revisit if cardinality grows.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  getAllStandardsActivity,
  totalSignal,
} from "@/lib/admin/standard-activity";

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
  library: number;
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

  const [flagRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.customerFlaggedReviews)
    .where(eq(schema.customerFlaggedReviews.status, "open"));

  // Library badge: total active operational signals across the whole
  // standards library. Mirrors how /admin/model surfaces "rules
  // needing attention" — same aggregator, different reduction. Sum
  // across rules so the badge parallels the existing inbox badges
  // (overrideInbox: 47 = 47 overrides, library: 47 = 47 active
  // signals across all rules).
  let library = 0;
  try {
    const activity = await getAllStandardsActivity();
    for (const a of activity.values()) {
      library += totalSignal(a);
    }
  } catch {
    // Best-effort. If the standards library file isn't fetched yet
    // (e.g., a Vercel build that ran before scripts/fetch-substrate.sh)
    // or a query fails, render the rail without the badge rather than
    // 500ing the whole admin surface.
  }

  return {
    todayQueue: Number(queueRow?.count ?? 0),
    overrideInbox: Number(overrideRow?.count ?? 0),
    customerFlags: Number(flagRow?.count ?? 0),
    library,
  };
}
