/**
 * Cross-source search across the three founder-facing review streams:
 *
 *   - violation_overrides       (customer disagreements)
 *   - violations                (review_recommended queue)
 *   - customer_flagged_reviews  (customer flags)
 *
 * Search modes:
 *
 *   - Substring (case-insensitive ILIKE) on whichever text field each
 *     table exposes — `text` on overrides + flags, `text_hash` on the
 *     queue (the queue stores hashes only).
 *   - Standard-ID exact match on `standard_id` (e.g. "ACT-01").
 *   - Hash prefix match on `text_hash` (e.g. "#a3f2…").
 *
 * Returns a flat list of typed results sorted most-recent-first
 * within each source, with a per-source cap. The UI groups them.
 */

import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

const PER_SOURCE_LIMIT = 8;
const MAX_QUERY_LEN = 200;

export type SearchResultType = "override" | "queue" | "flag";

export interface SearchResult {
  type: SearchResultType;
  id: string;
  textPreview: string;
  contextLine: string;
  createdAt: Date;
  href: string;
}

export interface SearchResults {
  query: string;
  results: SearchResult[];
  countsBySource: Record<SearchResultType, number>;
  truncated: boolean;
}

/**
 * Run the search.
 *
 * Returns at most PER_SOURCE_LIMIT results per source (24 total when
 * fully populated). The caller groups them; ordering within each
 * source is most-recent-first.
 */
export async function searchAdmin(rawQuery: string): Promise<SearchResults> {
  const query = rawQuery.trim().slice(0, MAX_QUERY_LEN);
  if (query.length === 0) {
    return {
      query,
      results: [],
      countsBySource: { override: 0, queue: 0, flag: 0 },
      truncated: false,
    };
  }

  const db = getDb();
  const ilikeQuery = `%${query}%`;
  const isHashLookup =
    query.startsWith("#") && /^#[a-f0-9]+$/i.test(query) && query.length >= 4;
  const hashPrefix = isHashLookup
    ? `${query.slice(1).toLowerCase()}%`
    : null;

  // -- overrides --------------------------------------------------------
  const overrideRows = await db
    .select({
      id: schema.violationOverrides.id,
      text: schema.violationOverrides.text,
      textHash: schema.violationOverrides.textHash,
      standardId: schema.violationOverrides.standardId,
      moment: schema.violationOverrides.moment,
      source: schema.violationOverrides.source,
      status: schema.violationOverrides.overrideStatus,
      createdAt: schema.violationOverrides.createdAt,
    })
    .from(schema.violationOverrides)
    .where(
      hashPrefix
        ? ilike(schema.violationOverrides.textHash, hashPrefix)
        : or(
            ilike(schema.violationOverrides.standardId, ilikeQuery),
            ilike(schema.violationOverrides.text, ilikeQuery),
          ),
    )
    .orderBy(desc(schema.violationOverrides.createdAt))
    .limit(PER_SOURCE_LIMIT);

  // -- queue (violations w/ review_reason_subtype set) -----------------
  const queueRows = await db
    .select({
      id: schema.violations.id,
      textHash: schema.violations.textHash,
      standardId: schema.violations.standardId,
      contentType: schema.violations.contentType,
      moment: schema.violations.moment,
      subtype: schema.violations.reviewReasonSubtype,
      createdAt: schema.violations.createdAt,
    })
    .from(schema.violations)
    .where(
      hashPrefix
        ? and(
            ilike(schema.violations.textHash, hashPrefix),
            sql`${schema.violations.reviewReasonSubtype} IS NOT NULL`,
          )
        : and(
            sql`${schema.violations.reviewReasonSubtype} IS NOT NULL`,
            or(
              ilike(schema.violations.standardId, ilikeQuery),
              ilike(schema.violations.contentType, ilikeQuery),
              ilike(schema.violations.moment, ilikeQuery),
            ),
          ),
    )
    .orderBy(desc(schema.violations.createdAt))
    .limit(PER_SOURCE_LIMIT);

  // -- customer flags --------------------------------------------------
  const flagRows = await db
    .select({
      id: schema.customerFlaggedReviews.id,
      text: schema.customerFlaggedReviews.text,
      textHash: schema.customerFlaggedReviews.textHash,
      flagReason: schema.customerFlaggedReviews.flagReason,
      customerNote: schema.customerFlaggedReviews.customerNote,
      verdict: schema.customerFlaggedReviews.verdict,
      status: schema.customerFlaggedReviews.status,
      createdAt: schema.customerFlaggedReviews.createdAt,
    })
    .from(schema.customerFlaggedReviews)
    .where(
      hashPrefix
        ? ilike(schema.customerFlaggedReviews.textHash, hashPrefix)
        : or(
            ilike(schema.customerFlaggedReviews.text, ilikeQuery),
            ilike(schema.customerFlaggedReviews.customerNote, ilikeQuery),
            eq(
              schema.customerFlaggedReviews.flagReason,
              query.toLowerCase() as
                | "doesnt_match_experience"
                | "lacks_context"
                | "not_clear_helpful_concise",
            ),
          ),
    )
    .orderBy(desc(schema.customerFlaggedReviews.createdAt))
    .limit(PER_SOURCE_LIMIT);

  const results: SearchResult[] = [
    ...overrideRows.map((r): SearchResult => ({
      type: "override",
      id: r.id,
      textPreview: r.text ?? `(text not retained — #${r.textHash.slice(0, 12)})`,
      contextLine: [
        r.standardId,
        r.moment ?? null,
        r.source,
        r.status,
      ]
        .filter(Boolean)
        .join(" · "),
      createdAt: r.createdAt,
      href: "/admin/overrides",
    })),
    ...queueRows.map((r): SearchResult => ({
      type: "queue",
      id: r.id,
      textPreview: `#${r.textHash.slice(0, 16)}`,
      contextLine: [
        r.standardId,
        r.subtype,
        r.contentType ?? null,
        r.moment ?? null,
      ]
        .filter(Boolean)
        .join(" · "),
      createdAt: r.createdAt,
      href: r.subtype ? `/admin/queue?subtype=${r.subtype}` : "/admin/queue",
    })),
    ...flagRows.map((r): SearchResult => ({
      type: "flag",
      id: r.id,
      textPreview: r.text,
      contextLine: [
        r.flagReason,
        r.verdict ?? null,
        r.status,
        r.customerNote ? `note: ${r.customerNote.slice(0, 80)}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      createdAt: r.createdAt,
      href: "/admin/customer-flags",
    })),
  ];

  // Most-recent-first across the merged list.
  results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return {
    query,
    results,
    countsBySource: {
      override: overrideRows.length,
      queue: queueRows.length,
      flag: flagRows.length,
    },
    truncated:
      overrideRows.length === PER_SOURCE_LIMIT ||
      queueRows.length === PER_SOURCE_LIMIT ||
      flagRows.length === PER_SOURCE_LIMIT,
  };
}
