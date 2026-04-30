/**
 * Data helpers for `/admin/overrides` (override inbox).
 *
 * Phase 5 of the pre-pilot launch build. The inbox reads
 * `violation_overrides` rows where `override_status = 'open'` and
 * shows them as a triage queue. The founder picks one of three
 * resolutions per row:
 *
 *   - addressed_corpus   → add to the eval corpus as a pass example
 *                          (the pilot was right)
 *   - addressed_patch    → route into the patch queue
 *                          (the rule needs work)
 *   - not_actionable     → the pilot was wrong; the rule fired correctly
 *
 * No new schema beyond Phase 5a's three columns
 * (`override_status`, `override_status_updated_by`,
 * `override_status_updated_at`, `override_status_notes`).
 *
 * Filters: by user, by standard, by time window. The default view
 * shows open overrides sorted most-recent-first.
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

export type OverrideStatus =
  | "open"
  | "addressed_corpus"
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
  // Corpus-loop fields (Session 8). `text` is null unless the pilot
  // explicitly opted in at dismiss time; `exportedAt` is set after
  // the export script writes the row to the private corpus.
  contributeUpstream: boolean;
  text: string | null;
  exportedAt: Date | null;
}

export interface InboxFilters {
  /** Only rows for this user. Default: all users. */
  userId?: string;
  /** Only rows for this standard. Default: all standards. */
  standardId?: string;
  /** Only rows newer than this date. Default: last 30 days. */
  since?: Date;
  /** Override-status filter. Default: 'open' (the triage queue);
   * pass 'all' to include resolved rows in the per-user detail
   * view. */
  status?: OverrideStatus | "all";
  /** Max rows to return. Default 200 — enough for a busy week, small
   * enough to keep the page snappy. */
  limit?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_LIMIT = 200;

/** Read inbox rows matching the filters, sorted most-recent-first. */
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
      contributeUpstream: schema.violationOverrides.contributeUpstream,
      text: schema.violationOverrides.text,
      exportedAt: schema.violationOverrides.exportedAt,
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
    contributeUpstream: r.contributeUpstream,
    text: r.text,
    exportedAt: r.exportedAt,
  }));
}

/** Triage one override from `open` into a resolved state. Returns
 * whether the row was actually flipped (false when another founder
 * already triaged it, or when the row doesn't exist). The
 * `override_status = 'open'` guard makes the UPDATE atomic against
 * concurrent triage actions: the second writer gets a clean
 * rejection instead of silently overwriting attribution. The UI
 * surfaces the rejection as "already triaged by another admin"
 * (or stale-state) rather than a successful-but-stale write. */
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

/** Inbox-summary count per status. Used in the inbox header to
 * answer "how many opens are waiting?" without re-querying when the
 * user filters. */
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
    addressed_corpus: 0,
    addressed_patch: 0,
    not_actionable: 0,
  };
  for (const row of rows) {
    out[row.status as OverrideStatus] = row.count;
  }
  return out;
}
