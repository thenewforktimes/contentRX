/**
 * Data helpers for `/admin/overrides` (override inbox).
 *
 * The inbox reads `violation_overrides` rows where
 * `override_status = 'open'` and shows them as a triage queue. The
 * founder picks one of two resolutions per row:
 *
 *   - addressed_patch    → route into the patch queue (the rule
 *                          needs work)
 *   - not_actionable     → the pilot was wrong; the rule fired
 *                          correctly
 *
 * Per ADR 2026-05-11 the override row is hash-only. The corpus
 * contribution path moved to the Flag-for-Review surface
 * (`customer_flagged_reviews`); overrides do not feed calibration.
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

export type OverrideStatus =
  | "open"
  | "addressed_patch"
  | "not_actionable";

export interface InboxRow {
  id: string;
  userId: string | null;
  userEmail: string | null;
  standardId: string;
  moment: string | null;
  textHash: string;
  overrideType: string;
  overrideReason: string | null;
  overrideReasonCode: string | null;
  overrideStance: string | null;
  source: string;
  status: OverrideStatus;
  createdAt: Date;
}

export interface InboxFilters {
  userId?: string;
  standardId?: string;
  since?: Date;
  status?: OverrideStatus | "all";
  limit?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_LIMIT = 200;

export async function loadOverrideInbox(
  filters: InboxFilters = {},
): Promise<InboxRow[]> {
  const db = getDb();
  const since =
    filters.since ?? new Date(Date.now() - DEFAULT_WINDOW_DAYS * DAY_MS);
  const status = filters.status ?? "open";

  const conditions = [gte(schema.violationOverrides.createdAt, since)];
  if (filters.userId) {
    conditions.push(eq(schema.violationOverrides.userId, filters.userId));
  }
  if (filters.standardId) {
    conditions.push(
      eq(schema.violationOverrides.standardId, filters.standardId),
    );
  }
  if (status !== "all") {
    conditions.push(eq(schema.violationOverrides.overrideStatus, status));
  }

  const rows = await db
    .select({
      id: schema.violationOverrides.id,
      userId: schema.violationOverrides.userId,
      userEmail: schema.users.email,
      standardId: schema.violationOverrides.standardId,
      moment: schema.violationOverrides.moment,
      textHash: schema.violationOverrides.textHash,
      overrideType: schema.violationOverrides.overrideType,
      overrideReason: schema.violationOverrides.overrideReason,
      overrideReasonCode: schema.violationOverrides.overrideReasonCode,
      overrideStance: schema.violationOverrides.overrideStance,
      source: schema.violationOverrides.source,
      status: schema.violationOverrides.overrideStatus,
      createdAt: schema.violationOverrides.createdAt,
    })
    .from(schema.violationOverrides)
    .leftJoin(
      schema.users,
      eq(schema.violationOverrides.userId, schema.users.id),
    )
    .where(and(...conditions))
    .orderBy(desc(schema.violationOverrides.createdAt))
    .limit(filters.limit ?? DEFAULT_LIMIT);

  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    userEmail: r.userEmail,
    standardId: r.standardId,
    moment: r.moment,
    textHash: r.textHash,
    overrideType: r.overrideType,
    overrideReason: r.overrideReason,
    overrideReasonCode: r.overrideReasonCode,
    overrideStance: r.overrideStance,
    source: r.source,
    status: r.status as OverrideStatus,
    createdAt: r.createdAt,
  }));
}

/** Triage one override from `open` into a resolved state. Returns
 * whether the row was actually flipped (false when another founder
 * already triaged it, or when the row doesn't exist). */
export async function triageOverride(args: {
  overrideId: string;
  newStatus: Exclude<OverrideStatus, "open">;
  triagedBy: string;
  notes?: string;
}): Promise<boolean> {
  const db = getDb();
  const result = await db
    .update(schema.violationOverrides)
    .set({
      overrideStatus: args.newStatus,
      overrideStatusUpdatedBy: args.triagedBy,
      overrideStatusUpdatedAt: new Date(),
      overrideStatusNotes: args.notes ?? null,
    })
    .where(
      and(
        eq(schema.violationOverrides.id, args.overrideId),
        eq(schema.violationOverrides.overrideStatus, "open"),
      ),
    )
    .returning({ id: schema.violationOverrides.id });
  return result.length > 0;
}

export async function inboxCounts(opts: {
  since?: Date;
} = {}): Promise<Record<OverrideStatus, number>> {
  const db = getDb();
  const since =
    opts.since ?? new Date(Date.now() - DEFAULT_WINDOW_DAYS * DAY_MS);
  const rows = await db
    .select({
      status: schema.violationOverrides.overrideStatus,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.violationOverrides)
    .where(gte(schema.violationOverrides.createdAt, since))
    .groupBy(schema.violationOverrides.overrideStatus);

  const out: Record<OverrideStatus, number> = {
    open: 0,
    addressed_patch: 0,
    not_actionable: 0,
  };
  for (const row of rows) {
    out[row.status as OverrideStatus] = row.count;
  }
  return out;
}
