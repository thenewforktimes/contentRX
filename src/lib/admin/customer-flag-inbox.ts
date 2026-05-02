/**
 * Data helpers for `/admin/customer-flags` (customer flag inbox).
 *
 * Reads `customer_flagged_reviews` rows where `status = 'open'` and
 * shows them as a triage queue. Mirrors the violation-overrides
 * inbox shape so the founder uses the same mental model on both.
 *
 * Triage resolutions:
 *
 *   - addressed_corpus     → added to the eval corpus as a calibration
 *                            example
 *   - addressed_taxonomy   → routed into a standards-library refinement
 *   - addressed_patch      → fix landed elsewhere (engine prompt, etc.)
 *   - not_actionable       → flagged in good faith but no model change
 *                            is the right response
 *
 * The customer's plaintext IS displayed here (unlike override-inbox,
 * where text is null unless the pilot explicitly opted in). The
 * existence of a customer_flagged_reviews row implies the per-flag
 * consent — every row is opt-in by definition.
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

export type FlagStatus =
  | "open"
  | "addressed_corpus"
  | "addressed_taxonomy"
  | "addressed_patch"
  | "not_actionable";

export type FlagReason =
  | "doesnt_match_experience"
  | "lacks_context"
  | "not_clear_helpful_concise";

export interface FlagInboxRow {
  id: string;
  userId: string | null;
  userEmail: string | null;
  text: string;
  textHash: string;
  contentType: string | null;
  moment: string | null;
  verdict: string | null;
  flagReason: FlagReason;
  customerNote: string | null;
  source: string;
  status: FlagStatus;
  consentRecordedAt: Date;
  createdAt: Date;
  exportedAt: Date | null;
}

export interface FlagInboxFilters {
  status?: FlagStatus | "all";
  since?: Date;
  limit?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 60;
const DEFAULT_LIMIT = 200;

export async function loadFlagInbox(
  filters: FlagInboxFilters = {},
): Promise<FlagInboxRow[]> {
  const db = getDb();
  const since =
    filters.since ?? new Date(Date.now() - DEFAULT_WINDOW_DAYS * DAY_MS);
  const status = filters.status ?? "open";
  const limit = filters.limit ?? DEFAULT_LIMIT;

  const conditions = [gte(schema.customerFlaggedReviews.createdAt, since)];
  if (status !== "all") {
    conditions.push(eq(schema.customerFlaggedReviews.status, status));
  }

  const rows = await db
    .select({
      id: schema.customerFlaggedReviews.id,
      userId: schema.customerFlaggedReviews.userId,
      userEmail: schema.users.email,
      text: schema.customerFlaggedReviews.text,
      textHash: schema.customerFlaggedReviews.textHash,
      contentType: schema.customerFlaggedReviews.contentType,
      moment: schema.customerFlaggedReviews.moment,
      verdict: schema.customerFlaggedReviews.verdict,
      flagReason: schema.customerFlaggedReviews.flagReason,
      customerNote: schema.customerFlaggedReviews.customerNote,
      source: schema.customerFlaggedReviews.source,
      status: schema.customerFlaggedReviews.status,
      consentRecordedAt: schema.customerFlaggedReviews.consentRecordedAt,
      createdAt: schema.customerFlaggedReviews.createdAt,
      exportedAt: schema.customerFlaggedReviews.exportedAt,
    })
    .from(schema.customerFlaggedReviews)
    .leftJoin(
      schema.users,
      eq(schema.customerFlaggedReviews.userId, schema.users.id),
    )
    .where(and(...conditions))
    .orderBy(desc(schema.customerFlaggedReviews.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    flagReason: r.flagReason as FlagReason,
    status: r.status as FlagStatus,
  }));
}

export interface FlagInboxCounts {
  open: number;
  total: number;
}

export async function flagInboxCounts(): Promise<FlagInboxCounts> {
  const db = getDb();
  const [openRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.customerFlaggedReviews)
    .where(eq(schema.customerFlaggedReviews.status, "open"));
  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.customerFlaggedReviews);
  return {
    open: Number(openRow?.count ?? 0),
    total: Number(totalRow?.count ?? 0),
  };
}

/**
 * Triage a single flag. Race-guarded: only flips when the row is in
 * 'open' status, so two concurrent triagers can't both apply different
 * resolutions. Returns true iff the row was triaged.
 */
export async function triageFlag(args: {
  flagId: string;
  newStatus: Exclude<FlagStatus, "open">;
  triagedBy: string;
  notes?: string;
}): Promise<boolean> {
  const db = getDb();
  const result = await db
    .update(schema.customerFlaggedReviews)
    .set({
      status: args.newStatus,
      triagedBy: args.triagedBy,
      triagedAt: new Date(),
      triageNotes: args.notes ?? null,
    })
    .where(
      and(
        eq(schema.customerFlaggedReviews.id, args.flagId),
        eq(schema.customerFlaggedReviews.status, "open"),
      ),
    )
    .returning({ id: schema.customerFlaggedReviews.id });
  return result.length > 0;
}
