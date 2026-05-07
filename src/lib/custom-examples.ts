/**
 * Custom examples — team-authored short-circuit decisions.
 *
 * Human-eval build plan Session 30. A custom example is a team-scoped
 * entry of the form `{text, verdict, optional context}` that, when
 * its normalized text matches an incoming evaluation, short-circuits
 * the LLM call and returns the stored verdict directly.
 *
 * Match semantics: exact text, normalized (case-folded, whitespace
 * collapsed). Optional `moment` and `contentType` scope the match
 * further — when set, the entry only fires when the request's
 * context matches. When unset, the entry applies to any context.
 * Matches are never fuzzy; "Let's go." and "Lets go" are distinct.
 *
 * Hot path: this module's `findMatchingExample()` runs on every
 * /api/check request for Team-plan users. The `(team_owner_user_id,
 * normalized_text)` index in `schema.ts` makes the lookup O(log n).
 *
 * Upstream contribution: entries with `contributeUpstream: true` are
 * eligible for anonymised review by Robert and potential integration
 * into the core content model. The transparency + opt-out commitment
 * sits on /ethics (Commitment 4, "Sources I have rights to use").
 * Defaults to false; no assumptions.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { RationaleHop } from "@/lib/evaluate";

export const CUSTOM_EXAMPLES_CAP_PER_TEAM = 500;

/**
 * Normalize a string for matching. Lower-case, trim, collapse any
 * run of whitespace (including tabs, newlines) to a single space.
 * The canonical form is what ends up in `team_custom_examples.normalized_text`.
 */
export function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface MatchLookup {
  teamOwnerUserId: string;
  text: string;
  moment?: string | null;
  contentType?: string | null;
}

export type CustomExample = typeof schema.teamCustomExamples.$inferSelect;

/**
 * Look up a custom example matching the request.
 *
 * Match rule:
 *   - `normalized_text` must equal `normalizeText(params.text)`.
 *   - If the stored entry has a non-null `moment`, it must equal the
 *     request's moment. Null `moment` on the entry matches any
 *     request moment.
 *   - Same rule for `content_type`.
 *
 * When multiple entries could match (e.g. a moment-scoped entry and
 * a moment-agnostic entry both apply), the more specific one wins.
 * Ties within specificity fall back to the newest entry so a team's
 * latest edit takes precedence.
 */
export async function findMatchingExample(
  params: MatchLookup,
): Promise<CustomExample | null> {
  const db = getDb();
  const normalized = normalizeText(params.text);

  const rows = await db
    .select()
    .from(schema.teamCustomExamples)
    .where(
      and(
        eq(schema.teamCustomExamples.teamOwnerUserId, params.teamOwnerUserId),
        eq(schema.teamCustomExamples.normalizedText, normalized),
      ),
    )
    // Deterministic order: most-recently-created first; id ASC tie-break
    // for rows that landed in the same millisecond (timestamp resolution
    // collisions are rare but real with bulk inserts).
    .orderBy(
      desc(schema.teamCustomExamples.createdAt),
      schema.teamCustomExamples.id,
    );

  return pickBestMatch(rows, params) ?? null;
}

/**
 * Pure helper: filter rows against the request's context and pick
 * the most-specific match. Exported for unit tests — the production
 * path goes through `findMatchingExample()` which wraps it.
 */
export function pickBestMatch(
  rows: CustomExample[],
  ctx: { moment?: string | null; contentType?: string | null },
): CustomExample | null {
  const candidates = rows.filter((r) => {
    if (r.moment && r.moment !== (ctx.moment ?? null)) return false;
    if (r.contentType && r.contentType !== (ctx.contentType ?? null)) {
      return false;
    }
    return true;
  });
  if (candidates.length === 0) return null;
  // Specificity score: +1 for each filled-in context column.
  const scored = candidates.map((c) => ({
    row: c,
    score: (c.moment ? 1 : 0) + (c.contentType ? 1 : 0),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.row;
}

/**
 * Shape a `CustomExample` match into a CheckResult-compatible
 * short-circuit. The caller overlays these fields on its result
 * envelope; the rationale hop is what makes the short-circuit
 * legible to the user via the Session 21 "Why this verdict?" panel.
 */
export interface ShortCircuitResult {
  verdict: "pass" | "violation";
  overall_verdict: "pass" | "fail";
  matched_example_id: string;
  notes: string | null;
  rationale_hop: RationaleHop;
  violations: Array<{
    standard_id: string;
    rule: string;
    issue: string;
    suggestion: string;
    source: string;
  }>;
}

export function shortCircuitFromExample(
  example: CustomExample,
): ShortCircuitResult {
  const violations =
    example.verdict === "violation" && example.standardId
      ? [
          {
            standard_id: example.standardId,
            rule: example.notes ?? "Flagged by team custom example.",
            issue: "Team custom example asserts this string is a violation.",
            suggestion:
              example.notes ??
              "See the team's custom-example notes for guidance.",
            source: "custom_example" as const,
          },
        ]
      : [];

  return {
    verdict: example.verdict,
    overall_verdict: example.verdict === "pass" ? "pass" : "fail",
    matched_example_id: example.id,
    notes: example.notes,
    violations,
    rationale_hop: {
      step: "custom_example_match",
      inputs: {
        team_owner_user_id: example.teamOwnerUserId,
      },
      output: {
        matched_example_id: example.id,
        verdict: example.verdict,
        notes: example.notes,
        moment: example.moment,
        content_type: example.contentType,
      },
      confidence: 1.0,
      rule_versions: example.standardId
        ? { [example.standardId]: "team_custom" }
        : {},
      ambiguity_flag: null,
    },
  };
}

/**
 * Count a team's current custom-example rows. Used by the create
 * endpoint to enforce `CUSTOM_EXAMPLES_CAP_PER_TEAM`.
 */
export async function countExamplesForTeam(
  teamOwnerUserId: string,
): Promise<number> {
  const db = getDb();
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.teamCustomExamples)
    .where(
      eq(schema.teamCustomExamples.teamOwnerUserId, teamOwnerUserId),
    );
  return result[0]?.count ?? 0;
}
