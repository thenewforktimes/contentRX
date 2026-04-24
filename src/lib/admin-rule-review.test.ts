import { describe, expect, it } from "vitest";
import {
  aggregateRuleReview,
  DEFAULT_MIN_TEAMS,
  DEFAULT_MIN_VIOLATIONS_PER_TEAM,
} from "./admin-rule-review";
import type { TeamCount } from "./admin-rule-review";

function makeBuckets(
  teamCount: number,
  violations: number,
  overrideRate: number,
  standardId: string = "STD-A",
): { violations: TeamCount[]; overrides: TeamCount[] } {
  const v: TeamCount[] = [];
  const o: TeamCount[] = [];
  for (let i = 0; i < teamCount; i++) {
    const teamId = `team_${i}`;
    v.push({ teamId, standardId, count: violations });
    o.push({
      teamId,
      standardId,
      count: Math.round(violations * overrideRate),
    });
  }
  return { violations: v, overrides: o };
}

describe("aggregateRuleReview", () => {
  it("returns empty when no teams meet threshold", () => {
    const { violations, overrides } = makeBuckets(5, 10, 0.4);
    const rows = aggregateRuleReview({ violations, overrides });
    expect(rows).toEqual([]);
  });

  it("surfaces a standard with enough qualifying teams", () => {
    const { violations, overrides } = makeBuckets(
      DEFAULT_MIN_TEAMS,
      10,
      0.3,
    );
    const rows = aggregateRuleReview({ violations, overrides });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.standardId).toBe("STD-A");
    expect(rows[0]!.teamsQualifying).toBe(DEFAULT_MIN_TEAMS);
    expect(rows[0]!.teamsWithData).toBe(DEFAULT_MIN_TEAMS);
    expect(rows[0]!.totalOverrides).toBe(
      DEFAULT_MIN_TEAMS * Math.round(10 * 0.3),
    );
  });

  it("omits teams whose override rate is below threshold", () => {
    // Half the teams override at 30%, half at 10%. Only the 30% teams
    // should count toward teamsQualifying.
    const strong = makeBuckets(DEFAULT_MIN_TEAMS, 10, 0.4);
    const weak = makeBuckets(DEFAULT_MIN_TEAMS, 10, 0.1);
    const rows = aggregateRuleReview({
      violations: [...strong.violations, ...weak.violations.map((v, i) => ({
        ...v,
        teamId: `low_${i}`,
      }))],
      overrides: [...strong.overrides, ...weak.overrides.map((v, i) => ({
        ...v,
        teamId: `low_${i}`,
      }))],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.teamsQualifying).toBe(DEFAULT_MIN_TEAMS);
    expect(rows[0]!.teamsWithData).toBe(DEFAULT_MIN_TEAMS * 2);
  });

  it("requires at least minViolationsPerTeam for a team to count", () => {
    // Team has 3 violations and 3 overrides (100% rate). That sounds
    // damning but 3 is under the default noise floor of 5, so the
    // team shouldn't contribute.
    const violations: TeamCount[] = [];
    const overrides: TeamCount[] = [];
    for (let i = 0; i < DEFAULT_MIN_TEAMS; i++) {
      violations.push({
        teamId: `team_${i}`,
        standardId: "STD-A",
        count: DEFAULT_MIN_VIOLATIONS_PER_TEAM - 1,
      });
      overrides.push({
        teamId: `team_${i}`,
        standardId: "STD-A",
        count: DEFAULT_MIN_VIOLATIONS_PER_TEAM - 1,
      });
    }
    expect(aggregateRuleReview({ violations, overrides })).toEqual([]);
  });

  it("computes median override rate across qualifying teams", () => {
    const violations: TeamCount[] = [];
    const overrides: TeamCount[] = [];
    const rates = Array.from({ length: DEFAULT_MIN_TEAMS }, (_, i) => 0.3 + i * 0.01);
    rates.forEach((rate, i) => {
      violations.push({ teamId: `t_${i}`, standardId: "STD-A", count: 100 });
      overrides.push({
        teamId: `t_${i}`,
        standardId: "STD-A",
        count: Math.round(rate * 100),
      });
    });
    const rows = aggregateRuleReview({ violations, overrides });
    expect(rows).toHaveLength(1);
    const sorted = [...rates].sort((a, b) => a - b);
    const expectedMedian =
      sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
        : sorted[Math.floor(sorted.length / 2)]!;
    expect(rows[0]!.medianOverrideRate).toBeCloseTo(expectedMedian, 4);
  });

  it("sorts by total_overrides descending", () => {
    // Two standards both hit threshold. A has more overrides → first.
    const stdA = makeBuckets(DEFAULT_MIN_TEAMS, 20, 0.4, "STD-A");
    const stdB = makeBuckets(DEFAULT_MIN_TEAMS, 10, 0.4, "STD-B");
    const rows = aggregateRuleReview({
      violations: [...stdA.violations, ...stdB.violations],
      overrides: [...stdA.overrides, ...stdB.overrides],
    });
    expect(rows.map((r) => r.standardId)).toEqual(["STD-A", "STD-B"]);
  });

  it("drops rows without teamId or standardId", () => {
    const rows = aggregateRuleReview({
      violations: [
        { teamId: "", standardId: "STD-A", count: 10 },
        { teamId: "team_1", standardId: "", count: 10 },
      ],
      overrides: [],
    });
    expect(rows).toEqual([]);
  });

  it("respects custom thresholds", () => {
    const { violations, overrides } = makeBuckets(5, 10, 0.5);
    const rows = aggregateRuleReview({
      violations,
      overrides,
      minTeams: 3,
      minOverrideRate: 0.4,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.teamsQualifying).toBe(5);
  });

  it("counts maxOverrideRate across all teams with data", () => {
    // A team that hits 100% should show up in maxOverrideRate even
    // if its (team, standard) has few violations — we still want to
    // see the outlier when ranking by impact.
    const { violations, overrides } = makeBuckets(DEFAULT_MIN_TEAMS, 10, 0.3);
    // Add one team at 100%.
    violations.push({ teamId: "whale", standardId: "STD-A", count: 50 });
    overrides.push({ teamId: "whale", standardId: "STD-A", count: 50 });
    const rows = aggregateRuleReview({ violations, overrides });
    expect(rows[0]!.maxOverrideRate).toBeCloseTo(1.0, 2);
  });
});
