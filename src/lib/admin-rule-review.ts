/**
 * Cross-team rule-review aggregation.
 *
 * BUILD_PLAN_v2 Session 13. Internal admin page at
 * `/admin/rule-review` surfaces standards that teams consistently
 * override. The threshold the spec calls for: "rules with >25%
 * override rate across >20 teams, sorted by impact."
 *
 * Pure logic lives here so the page component stays thin and the
 * math is unit-tested. The page passes in already-fetched
 * (standard_id, team_id, count) rollups from SQL and this module
 * turns them into the review queue.
 *
 * "Override rate" per (team, standard) = overrides ÷ violations.
 * Both numerator and denominator are bounded by the same time
 * window so a newly-introduced standard doesn't appear to have a
 * sky-high rate just because violations haven't accumulated yet.
 */

export interface TeamCount {
  teamId: string;
  standardId: string;
  count: number;
}

export interface RuleReviewInput {
  violations: readonly TeamCount[];
  overrides: readonly TeamCount[];
  minTeams?: number;
  minOverrideRate?: number;
  minViolationsPerTeam?: number;
}

export interface StandardReviewRow {
  standardId: string;
  teamsQualifying: number;
  teamsWithData: number;
  totalOverrides: number;
  medianOverrideRate: number;
  maxOverrideRate: number;
}

export const DEFAULT_MIN_TEAMS = 20;
export const DEFAULT_MIN_OVERRIDE_RATE = 0.25;
// Require at least this many violations per (team, standard) before
// we trust the ratio. A single violation with one override would
// otherwise claim 100% override rate and dominate the queue.
export const DEFAULT_MIN_VIOLATIONS_PER_TEAM = 5;

/**
 * Aggregate overrides + violations into the rule-review queue.
 *
 * Returns one row per standard_id that meets the thresholds, sorted
 * by total-overrides descending. Standards that don't meet the
 * thresholds drop out entirely — the admin view should show only
 * actionable signals.
 */
export function aggregateRuleReview(
  input: RuleReviewInput,
): StandardReviewRow[] {
  const minTeams = input.minTeams ?? DEFAULT_MIN_TEAMS;
  const minOverrideRate = input.minOverrideRate ?? DEFAULT_MIN_OVERRIDE_RATE;
  const minViolationsPerTeam =
    input.minViolationsPerTeam ?? DEFAULT_MIN_VIOLATIONS_PER_TEAM;

  // Index violations by (teamId|standardId) → count. Overrides
  // without a matching violation row are dropped — we need the
  // denominator to compute a rate.
  const violationIndex = new Map<string, number>();
  for (const v of input.violations) {
    if (!v.teamId || !v.standardId) continue;
    const key = `${v.teamId}|${v.standardId}`;
    violationIndex.set(key, (violationIndex.get(key) ?? 0) + v.count);
  }

  // Same for overrides, scoped by (team, standard).
  const overrideIndex = new Map<string, number>();
  for (const o of input.overrides) {
    if (!o.teamId || !o.standardId) continue;
    const key = `${o.teamId}|${o.standardId}`;
    overrideIndex.set(key, (overrideIndex.get(key) ?? 0) + o.count);
  }

  // Group per-team rates by standard_id.
  const perStandard = new Map<
    string,
    {
      teamsWithData: number;
      qualifyingRates: number[];
      totalOverrides: number;
      maxRate: number;
    }
  >();

  // Walk the violation index (the universe of "teams that touched
  // this standard at all"). An (team, standard) with zero overrides
  // is a useful signal: it still counts toward `teamsWithData` but
  // not toward `qualifyingRates`.
  for (const [key, violationCount] of violationIndex) {
    if (violationCount < minViolationsPerTeam) continue;
    const [, standardId] = key.split("|");
    if (!standardId) continue;
    const overrideCount = overrideIndex.get(key) ?? 0;
    const rate = overrideCount / violationCount;

    const bucket =
      perStandard.get(standardId) ?? {
        teamsWithData: 0,
        qualifyingRates: [],
        totalOverrides: 0,
        maxRate: 0,
      };
    bucket.teamsWithData += 1;
    if (rate >= minOverrideRate) {
      bucket.qualifyingRates.push(rate);
      bucket.totalOverrides += overrideCount;
    }
    if (rate > bucket.maxRate) bucket.maxRate = rate;
    perStandard.set(standardId, bucket);
  }

  const out: StandardReviewRow[] = [];
  for (const [standardId, bucket] of perStandard) {
    if (bucket.qualifyingRates.length < minTeams) continue;
    out.push({
      standardId,
      teamsQualifying: bucket.qualifyingRates.length,
      teamsWithData: bucket.teamsWithData,
      totalOverrides: bucket.totalOverrides,
      medianOverrideRate: median(bucket.qualifyingRates),
      maxOverrideRate: bucket.maxRate,
    });
  }

  // Sort by impact (total overrides) — highest first. Ties break on
  // standard_id so re-renders are stable.
  out.sort(
    (a, b) =>
      b.totalOverrides - a.totalOverrides ||
      a.standardId.localeCompare(b.standardId),
  );
  return out;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}
