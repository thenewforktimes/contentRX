/**
 * Pattern grouping for the weekly review agent (Phase G2, 2026-05-09
 * roadmap).
 *
 * The agent clusters a team's recent flags by pattern, not by file.
 * "Pattern" = same standard fired multiple times across the team's
 * writing. The grouping logic is deterministic, dependency-free, and
 * has no LLM in the path. Agent V1 uses the LLM only inside each
 * cluster's suggestion text (G3, day 4). The cluster-step itself is
 * pure: rule-based, testable, audit-friendly.
 *
 * Why deterministic: pattern grouping is a trust currency engineers
 * care about. If the same input data produces a different grouping
 * across runs, the agent reads as flaky. Deterministic ordering means
 * the digest's pattern list is stable until the underlying flag
 * stream changes.
 *
 * Cluster key:  standardId — the engine's substrate identifier for
 *               which standard fired. This is internal substrate (per
 *               ADR 2026-04-25) and never appears on a customer
 *               surface. The customer-facing translation lands in G3
 *               (digest rendering) and G4 (citation rendering).
 *
 * Sort order (stable across runs):
 *   1. Total count descending — biggest patterns first.
 *   2. Most-recent occurrence descending — fresher patterns float up.
 *   3. standardId ascending — tiebreaker for full determinism.
 */

/** Minimal violation shape the grouping function consumes. The actual
 * `violations` table has more fields (severity, content_type, moment,
 * etc.); this type is the projection the grouping cares about. */
export type ViolationSummary = {
  standardId: string;
  severity: "high" | "medium" | "low";
  createdAt: Date;
};

/** A cluster of violations sharing a standardId. */
export type Pattern = {
  /** Engine substrate identifier. Internal only — never render on a
   * customer surface. The G3/G4 rendering translates this to a
   * customer-facing pattern label. */
  standardId: string;
  /** Total flags in this cluster. */
  count: number;
  /** Per-severity breakdown. */
  severityCounts: { high: number; medium: number; low: number };
  /** Most recent occurrence in the cluster — drives the secondary
   * sort and the digest's "this week" framing. */
  lastSeen: Date;
};

/**
 * Group violations by standardId and return the clusters sorted
 * deterministically.
 */
export function groupByPattern(
  violations: readonly ViolationSummary[],
): Pattern[] {
  const buckets = new Map<string, Pattern>();
  for (const v of violations) {
    const existing = buckets.get(v.standardId);
    if (existing) {
      existing.count++;
      existing.severityCounts[v.severity]++;
      if (v.createdAt.getTime() > existing.lastSeen.getTime()) {
        existing.lastSeen = v.createdAt;
      }
    } else {
      buckets.set(v.standardId, {
        standardId: v.standardId,
        count: 1,
        severityCounts: {
          high: v.severity === "high" ? 1 : 0,
          medium: v.severity === "medium" ? 1 : 0,
          low: v.severity === "low" ? 1 : 0,
        },
        lastSeen: v.createdAt,
      });
    }
  }
  return Array.from(buckets.values()).sort(comparePatterns);
}

/** Top-N patterns. The roadmap calls out the digest's lead block as
 * "top three patterns per team identified deterministically." */
export function topNPatterns(
  violations: readonly ViolationSummary[],
  n = 3,
): Pattern[] {
  return groupByPattern(violations).slice(0, n);
}

/** Patterns with two or more flags. The G3 digest classifies its
 * header by the structure of these results: when patterns of 2+
 * matched flags exist, the digest reads "Flagged for drift this
 * week"; when 2-3 isolated flags exist with no repetition, the
 * header reads "This week's flags from your team's writing." */
export function patternsOfTwoOrMore(
  violations: readonly ViolationSummary[],
): Pattern[] {
  return groupByPattern(violations).filter((p) => p.count >= 2);
}

/** Isolated flags — standards that fired exactly once in the window.
 * Surface as the "Other flags this week" block when patterns coexist,
 * or as the lead block when no patterns reach the 2+ threshold. */
export function isolatedFlags(
  violations: readonly ViolationSummary[],
): Pattern[] {
  return groupByPattern(violations).filter((p) => p.count === 1);
}

/** Header variant the G3 digest renders. Selected by deterministic
 * flag-count logic; no customer action required. */
export type DigestHeaderVariant =
  | "drift" // patterns of 2+ matched flags exist
  | "no-repetition" // 2-3 flags, no repetition
  | "mixed" // both patterns and isolated flags
  | "empty"; // 0-1 flags total — the setup-prompt PR variant

/**
 * Choose the digest header variant for a set of violations. Mirrors
 * the G5 acceptance criteria so the digest header is selected from
 * deterministic input alone, not from the LLM.
 */
export function digestHeaderVariant(
  violations: readonly ViolationSummary[],
): DigestHeaderVariant {
  const patterns = patternsOfTwoOrMore(violations);
  const isolated = isolatedFlags(violations);
  const totalFlags = violations.length;
  if (totalFlags <= 1) return "empty";
  if (patterns.length > 0 && isolated.length > 0) return "mixed";
  if (patterns.length > 0) return "drift";
  return "no-repetition";
}

/** Stable comparator for two patterns. Exposed (not just inlined) so
 * tests can pin the exact ordering rule. */
function comparePatterns(a: Pattern, b: Pattern): number {
  if (b.count !== a.count) return b.count - a.count;
  const ta = a.lastSeen.getTime();
  const tb = b.lastSeen.getTime();
  if (tb !== ta) return tb - ta;
  return a.standardId.localeCompare(b.standardId);
}
