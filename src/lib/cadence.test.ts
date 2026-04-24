import { describe, it, expect } from "vitest";
import {
  MOMENT_ROTATION,
  aggregateVelocity,
  buildWeeklyDigest,
  detectUrgentFlags,
  isoWeek,
  momentForWeek,
  weekKey,
} from "./cadence";

// ---------------------------------------------------------------------------
// Moment rotation + ISO week
// ---------------------------------------------------------------------------

describe("isoWeek", () => {
  it("returns 1 for the first Thursday's week", () => {
    // 2026-01-01 is a Thursday → ISO week 1.
    expect(isoWeek(new Date("2026-01-01"))).toBe(1);
  });

  it("returns 53 for the end-of-year rollover when applicable", () => {
    // 2020-12-31 is a Thursday → ISO week 53.
    expect(isoWeek(new Date("2020-12-31"))).toBe(53);
  });

  it("respects ISO rollback — Jan 1 can belong to the previous year's last week", () => {
    // 2023-01-01 is a Sunday → week 52 of 2022.
    expect(isoWeek(new Date("2023-01-01"))).toBe(52);
  });
});

describe("weekKey", () => {
  it("formats YYYY-Www", () => {
    expect(weekKey(new Date("2026-04-23"))).toMatch(/^\d{4}-W\d{2}$/);
  });

  it("pads single-digit weeks", () => {
    expect(weekKey(new Date("2026-01-15"))).toBe("2026-W03");
  });
});

describe("momentForWeek", () => {
  it("returns a valid moment from the rotation", () => {
    const m = momentForWeek(new Date("2026-04-23"));
    expect(MOMENT_ROTATION).toContain(m);
  });

  it("cycles through all 13 moments in 13 consecutive weeks", () => {
    const seen = new Set<string>();
    const base = new Date("2026-01-01");
    for (let i = 0; i < 13; i++) {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + i * 7);
      seen.add(momentForWeek(d));
    }
    expect(seen.size).toBe(MOMENT_ROTATION.length);
  });

  it("is deterministic for the same date", () => {
    const d = new Date("2026-04-23");
    expect(momentForWeek(d)).toBe(momentForWeek(new Date(d)));
  });
});

// ---------------------------------------------------------------------------
// Urgent flags
// ---------------------------------------------------------------------------

function _row(standardId: string, when = "2026-04-23") {
  return {
    standardId,
    moment: null,
    createdAt: new Date(when),
    overrideStance: null,
  };
}

describe("detectUrgentFlags", () => {
  it("flags standards whose count spiked vs the prior-7-day average", () => {
    // CLR-01: 5 today, 7 prior (7/7 = 1/day) → 5x spike.
    const today = [
      _row("CLR-01"), _row("CLR-01"), _row("CLR-01"),
      _row("CLR-01"), _row("CLR-01"),
    ];
    const prior = [
      _row("CLR-01"), _row("CLR-01"), _row("CLR-01"), _row("CLR-01"),
      _row("CLR-01"), _row("CLR-01"), _row("CLR-01"),
    ];
    const flags = detectUrgentFlags(today, prior);
    expect(flags.length).toBe(1);
    expect(flags[0].kind).toBe("override_rate_spike");
    expect(flags[0].standardId).toBe("CLR-01");
  });

  it("flags a new standard (no prior activity) as out-of-distribution", () => {
    const today = [_row("NEW-01"), _row("NEW-01"), _row("NEW-01")];
    const flags = detectUrgentFlags(today, []);
    expect(flags[0].kind).toBe("new_out_of_distribution_cluster");
  });

  it("respects the minimum absolute count threshold", () => {
    // 2 overrides today, 0 prior — below default minAbsoluteCount=3.
    const today = [_row("X"), _row("X")];
    const flags = detectUrgentFlags(today, []);
    expect(flags).toEqual([]);
  });

  it("respects a custom spike multiplier", () => {
    // CLR-01: 4 today, 14 prior (2/day). With default mult=3 → 2x ratio,
    // no flag. With mult=1.5 → fires.
    const today = [_row("CLR-01"), _row("CLR-01"), _row("CLR-01"), _row("CLR-01")];
    const prior = Array.from({ length: 14 }, () => _row("CLR-01"));
    expect(detectUrgentFlags(today, prior).length).toBe(0);
    expect(detectUrgentFlags(today, prior, { spikeMultiplier: 1.5 }).length).toBe(1);
  });

  it("orders flags by descending delta", () => {
    const today = [
      _row("BIG-SPIKE"), _row("BIG-SPIKE"), _row("BIG-SPIKE"),
      _row("BIG-SPIKE"), _row("BIG-SPIKE"), _row("BIG-SPIKE"),
      _row("SMALL-SPIKE"), _row("SMALL-SPIKE"), _row("SMALL-SPIKE"),
    ];
    const prior = [_row("BIG-SPIKE")].concat(
      Array.from({ length: 6 }, () => _row("SMALL-SPIKE")),
    );
    const flags = detectUrgentFlags(today, prior);
    expect(flags[0].standardId).toBe("BIG-SPIKE");
  });
});

// ---------------------------------------------------------------------------
// Review velocity
// ---------------------------------------------------------------------------

describe("aggregateVelocity", () => {
  it("returns zeros on empty input", () => {
    const m = aggregateVelocity({
      batchTimestamps: [],
      batchSizes: [],
      batchDurationsMs: [],
    });
    expect(m.batchesCompleted).toBe(0);
    expect(m.itemsReviewed).toBe(0);
    expect(m.avgMsPerItem).toBeNull();
    expect(m.avgBatchSize).toBeNull();
  });

  it("computes average items per batch + ms per item", () => {
    const m = aggregateVelocity({
      batchTimestamps: [1, 2, 3],
      batchSizes: [3, 3, 3],
      batchDurationsMs: [9000, 9000, 9000],
    });
    expect(m.batchesCompleted).toBe(3);
    expect(m.itemsReviewed).toBe(9);
    expect(m.avgBatchSize).toBe(3);
    expect(m.avgMsPerItem).toBe(3000);
  });

  it("splits items into recent vs prior halves by timestamp order", () => {
    const m = aggregateVelocity({
      batchTimestamps: [1, 2, 3, 4],
      batchSizes: [10, 10, 1, 1],
      batchDurationsMs: [1000, 1000, 1000, 1000],
    });
    // Older half (timestamps 1, 2) → 20 items. Recent half (3, 4) → 2.
    expect(m.itemsReviewedPrior).toBe(20);
    expect(m.itemsReviewedRecent).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Weekly digest
// ---------------------------------------------------------------------------

describe("buildWeeklyDigest", () => {
  it("computes week-over-week delta in percent", () => {
    const payload = buildWeeklyDigest({
      weekStart: new Date("2026-04-20"),
      overridesThisWeek: Array.from({ length: 15 }, () => _row("CLR-01")),
      overridesPriorWeek: Array.from({ length: 10 }, () => _row("CLR-01")),
      topStandards: [{ standardId: "CLR-01", moment: null, count: 15 }],
      pendingRefinementCount: 2,
      nextMoment: "decision_point",
      dashboardUrl: "https://contentrx.io/dashboard/cadence",
    });
    expect(payload.totalOverridesThisWeek).toBe(15);
    expect(payload.totalOverridesPriorWeek).toBe(10);
    expect(payload.overrideDeltaPct).toBe(50);
  });

  it("returns null delta when prior week had activity but current week has new activity against zero", () => {
    const payload = buildWeeklyDigest({
      weekStart: new Date("2026-04-20"),
      overridesThisWeek: [_row("NEW-STD")],
      overridesPriorWeek: [],
      topStandards: [],
      pendingRefinementCount: 0,
      nextMoment: "first_encounter",
      dashboardUrl: "https://example.com",
    });
    // Prior=0, now>0 → we can't express as a clean percentage, so null.
    expect(payload.overrideDeltaPct).toBeNull();
  });

  it("caps topStandards at 5", () => {
    const payload = buildWeeklyDigest({
      weekStart: new Date("2026-04-20"),
      overridesThisWeek: [],
      overridesPriorWeek: [],
      topStandards: Array.from({ length: 10 }, (_, i) => ({
        standardId: `STD-${i}`,
        moment: null,
        count: 100 - i,
      })),
      pendingRefinementCount: 0,
      nextMoment: "confirmation",
      dashboardUrl: "https://example.com",
    });
    expect(payload.topStandards.length).toBe(5);
  });

  it("includes the next moment for the rotation reminder", () => {
    const payload = buildWeeklyDigest({
      weekStart: new Date("2026-04-20"),
      overridesThisWeek: [],
      overridesPriorWeek: [],
      topStandards: [],
      pendingRefinementCount: 0,
      nextMoment: "error_recovery",
      dashboardUrl: "https://example.com",
    });
    expect(payload.nextMoment).toBe("error_recovery");
  });
});
