/**
 * Per-standard activity aggregator for `/admin/model` mission control.
 *
 * Rolls up the operational signals each standard accumulates so the
 * founder can see at a glance which rules need attention and which are
 * steady-state. The /admin/model index uses these counts to surface a
 * "rules needing attention" section; the per-standard detail page
 * (/admin/model/standards/[id]) uses them as the activity panel header.
 *
 * Three signals (all that map cleanly to a single standard_id):
 *
 *   - overridesLast7d        violation_overrides rows in the last 7 days
 *   - customerFlagsOpen      customer_flagged_reviews where status='open',
 *                             joined to violations to get standard_id
 *   - suggestionCandidates   suggestion_candidates where status='pending'
 *                             AND share_upstream=true (founder-routable)
 *
 * Refinements live in `taxonomy_refinement_log.md` but are keyed at the
 * proposal level (current_category), not standard level — they don't
 * map 1:1 to a standardId. /admin/refinement-log is the canonical
 * surface for those; we don't try to fold them into per-standard
 * counts here.
 *
 * Single-query pattern: `getAllStandardsActivity()` returns a Map for
 * batch lookups (the index page renders 47+ standards; one query each
 * would be N+1). `getStandardActivity(id)` is a thin wrapper for the
 * single-standard detail page.
 *
 * "Attention" criteria — `attentionReasons(activity)`:
 *   - any open customer flag, OR
 *   - ≥ 3 open suggestion candidates, OR
 *   - ≥ 5 overrides in the last 7d.
 *
 * Tunable via the constants at the top of the file. The thresholds are
 * intentionally low for v1 — better to over-surface and let the founder
 * dismiss than under-surface and miss real drift.
 */

import "server-only";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface StandardActivity {
  standardId: string;
  overridesLast7d: number;
  customerFlagsOpen: number;
  suggestionCandidates: number;
}

export interface AttentionReason {
  kind: "customer_flag" | "override_spike" | "suggestion_pending";
  count: number;
  label: string;
}

// ---------------------------------------------------------------------------
// Thresholds — tweak here, not at call sites
// ---------------------------------------------------------------------------

const ATTENTION_OVERRIDE_THRESHOLD = 5;
const ATTENTION_SUGGESTION_THRESHOLD = 3;
const ATTENTION_FLAG_THRESHOLD = 1;

// ---------------------------------------------------------------------------
// Aggregators
// ---------------------------------------------------------------------------

/**
 * Returns a Map keyed by standardId with the four-signal activity counts.
 * Standards with zero activity across all four surfaces are NOT included
 * — callers should treat a missing key as "no signal" (use
 * `emptyActivity(id)` if you need a zero record).
 */
export async function getAllStandardsActivity(): Promise<
  Map<string, StandardActivity>
> {
  const db = getDb();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const map = new Map<string, StandardActivity>();
  function upsert(id: string): StandardActivity {
    let r = map.get(id);
    if (!r) {
      r = emptyActivity(id);
      map.set(id, r);
    }
    return r;
  }

  // Overrides last 7d — group by standard_id directly (no join needed).
  const overrideRows = await db
    .select({
      standardId: schema.violationOverrides.standardId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.violationOverrides)
    .where(gte(schema.violationOverrides.createdAt, sevenDaysAgo))
    .groupBy(schema.violationOverrides.standardId);
  for (const r of overrideRows) {
    if (!r.standardId) continue;
    upsert(r.standardId).overridesLast7d = Number(r.count);
  }

  // Customer flags open — JOIN through violations to get standard_id.
  // Flags on `pass` verdicts have null violationId; those are excluded
  // from per-standard rollups by the inner join.
  const flagRows = await db
    .select({
      standardId: schema.violations.standardId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.customerFlaggedReviews)
    .innerJoin(
      schema.violations,
      eq(schema.customerFlaggedReviews.violationId, schema.violations.id),
    )
    .where(
      and(
        eq(schema.customerFlaggedReviews.status, "open"),
        isNotNull(schema.violations.standardId),
      ),
    )
    .groupBy(schema.violations.standardId);
  for (const r of flagRows) {
    if (!r.standardId) continue;
    upsert(r.standardId).customerFlagsOpen = Number(r.count);
  }

  // Suggestion candidates pending + share-upstream
  const suggestionRows = await db
    .select({
      standardId: schema.suggestionCandidates.standardId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.suggestionCandidates)
    .where(
      sql`${schema.suggestionCandidates.status} = 'pending' AND ${schema.suggestionCandidates.shareUpstream} = true`,
    )
    .groupBy(schema.suggestionCandidates.standardId);
  for (const r of suggestionRows) {
    if (!r.standardId) continue;
    upsert(r.standardId).suggestionCandidates = Number(r.count);
  }

  return map;
}

/**
 * Single-standard activity. Built on top of the batch query for
 * consistency — avoids the per-page N+1 risk on the all-standards index
 * AND the divergent code paths between "summary" and "detail."
 */
export async function getStandardActivity(
  standardId: string,
): Promise<StandardActivity> {
  const all = await getAllStandardsActivity();
  return all.get(standardId) ?? emptyActivity(standardId);
}

// ---------------------------------------------------------------------------
// Attention logic
// ---------------------------------------------------------------------------

export function emptyActivity(standardId: string): StandardActivity {
  return {
    standardId,
    overridesLast7d: 0,
    customerFlagsOpen: 0,
    suggestionCandidates: 0,
  };
}

export function totalSignal(a: StandardActivity): number {
  return a.overridesLast7d + a.customerFlagsOpen + a.suggestionCandidates;
}

/**
 * Returns the list of reasons this standard needs attention right now,
 * or an empty array when none apply. The presence of any reason is the
 * "is hot" signal; the array gives the UI specific reasons to render
 * ("3 open customer flags · 7 overrides last 7d") rather than just a
 * dot.
 */
export function attentionReasons(a: StandardActivity): AttentionReason[] {
  const reasons: AttentionReason[] = [];
  if (a.customerFlagsOpen >= ATTENTION_FLAG_THRESHOLD) {
    reasons.push({
      kind: "customer_flag",
      count: a.customerFlagsOpen,
      label: `${a.customerFlagsOpen} open customer flag${a.customerFlagsOpen === 1 ? "" : "s"}`,
    });
  }
  if (a.overridesLast7d >= ATTENTION_OVERRIDE_THRESHOLD) {
    reasons.push({
      kind: "override_spike",
      count: a.overridesLast7d,
      label: `${a.overridesLast7d} overrides last 7d`,
    });
  }
  if (a.suggestionCandidates >= ATTENTION_SUGGESTION_THRESHOLD) {
    reasons.push({
      kind: "suggestion_pending",
      count: a.suggestionCandidates,
      label: `${a.suggestionCandidates} suggestion candidate${a.suggestionCandidates === 1 ? "" : "s"} pending`,
    });
  }
  return reasons;
}

export function needsAttention(a: StandardActivity): boolean {
  return attentionReasons(a).length > 0;
}
