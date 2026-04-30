/**
 * Data helpers for `/admin` (pilot tracker).
 *
 * Phase 5 of the pre-pilot launch build. The tracker is a single-page
 * activity feed: every user shows up with their plan, last check, and
 * 7-day / total counts so the founder can see who's actively using
 * the product, who hasn't logged in, and who's at risk.
 *
 * Status indicator semantics (the colored dot per row):
 *   - `green`   — checked in within the last 48 hours
 *   - `amber`   — checked in 48 hours to 7 days ago
 *   - `red`     — last check >7 days ago
 *   - `dormant` — never checked
 *
 * Conversation triggers fire as sidebar nudges:
 *   - `debrief_50_checks` — user crossed 50 checks in the last 7 days
 *   - `at_risk_idle`      — Pro/Team/Scale user with no check in 7 days
 *
 * Single-pass: one materialization, one read on dashboard load.
 * Cheap at <50 users; revisit if the cardinality grows.
 */

import { sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

export type ActivityStatus = "green" | "amber" | "red" | "dormant";

export interface PilotRow {
  userId: string;
  email: string;
  plan: "free" | "pro" | "scale" | "team";
  costPauseActive: boolean;
  lastCheckAt: Date | null;
  checks7d: number;
  checksTotal: number;
  overrideCount: number;
  status: ActivityStatus;
}

export type ConversationTrigger =
  | { kind: "debrief_50_checks"; userId: string; email: string; checks7d: number }
  | { kind: "at_risk_idle"; userId: string; email: string; daysIdle: number; plan: PilotRow["plan"] };

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Compute the activity status from the last-check timestamp. */
export function activityStatus(
  lastCheckAt: Date | null,
  now: Date = new Date(),
): ActivityStatus {
  if (lastCheckAt === null) return "dormant";
  const elapsed = now.getTime() - lastCheckAt.getTime();
  if (elapsed <= 48 * HOUR_MS) return "green";
  if (elapsed <= 7 * DAY_MS) return "amber";
  return "red";
}

/** Fetch all users with their per-user activity counts. Returns
 * one row per user, sorted most-recently-active first (nulls last).
 * Pulls the last-check timestamp + 7-day count + total count from
 * the `usage_events` table — the per-call event log added in Phase 4.
 *
 * Single-pass aggregation in SQL for the small-N case (<100 users).
 * If the user count grows past a few hundred, move to a materialized
 * view refreshed nightly. */
export async function loadPilotTracker(opts: {
  now?: Date;
} = {}): Promise<PilotRow[]> {
  const now = opts.now ?? new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
  const db = getDb();

  // Per-user check counts from usage_events.
  const events = await db
    .select({
      userId: schema.usageEvents.userId,
      lastCheckAt: sql<Date>`max(${schema.usageEvents.createdAt})`,
      checksTotal: sql<number>`count(*)::int`,
      checks7d: sql<number>`count(*) filter (where ${schema.usageEvents.createdAt} >= ${sevenDaysAgo})::int`,
    })
    .from(schema.usageEvents)
    .groupBy(schema.usageEvents.userId);
  const eventsByUser = new Map(events.map((e) => [e.userId, e]));

  // Per-user override counts from violation_overrides (all-time).
  const overrides = await db
    .select({
      userId: schema.violationOverrides.userId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.violationOverrides)
    .groupBy(schema.violationOverrides.userId);
  const overridesByUser = new Map(
    overrides
      .filter((o): o is { userId: string; count: number } => o.userId !== null)
      .map((o) => [o.userId, o.count]),
  );

  // Pull every user. The tracker is single-page — at <100 users this
  // unbounded scan is fine.
  const users = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      plan: schema.users.plan,
      costPauseActive: schema.users.costPauseActive,
    })
    .from(schema.users);

  const rows: PilotRow[] = users.map((user) => {
    const ev = eventsByUser.get(user.id);
    const lastCheckAt = ev?.lastCheckAt ? new Date(ev.lastCheckAt) : null;
    return {
      userId: user.id,
      email: user.email,
      plan: user.plan,
      costPauseActive: user.costPauseActive,
      lastCheckAt,
      checks7d: ev?.checks7d ?? 0,
      checksTotal: ev?.checksTotal ?? 0,
      overrideCount: overridesByUser.get(user.id) ?? 0,
      status: activityStatus(lastCheckAt, now),
    };
  });

  // Sort: most-recent activity first, dormant users last.
  rows.sort((a, b) => {
    if (a.lastCheckAt === null && b.lastCheckAt === null) return 0;
    if (a.lastCheckAt === null) return 1;
    if (b.lastCheckAt === null) return -1;
    return b.lastCheckAt.getTime() - a.lastCheckAt.getTime();
  });

  return rows;
}

/** Fire conversation triggers from the tracker rows. A single user
 * can produce multiple triggers; the founder dashboard's sidebar
 * groups them. */
export function conversationTriggers(rows: PilotRow[]): ConversationTrigger[] {
  const triggers: ConversationTrigger[] = [];
  for (const row of rows) {
    if (row.checks7d >= 50) {
      triggers.push({
        kind: "debrief_50_checks",
        userId: row.userId,
        email: row.email,
        checks7d: row.checks7d,
      });
    }
    if (
      row.plan !== "free" &&
      row.lastCheckAt !== null &&
      row.status === "red"
    ) {
      const daysIdle = Math.floor(
        (Date.now() - row.lastCheckAt.getTime()) / DAY_MS,
      );
      triggers.push({
        kind: "at_risk_idle",
        userId: row.userId,
        email: row.email,
        daysIdle,
        plan: row.plan,
      });
    }
  }
  return triggers;
}
