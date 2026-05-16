import { describe, expect, it } from "vitest";
import {
  buildConflictClusters,
  buildOODClusters,
  buildOverrideClusters,
  buildSignalDump,
  buildStandardSignals,
  OUT_OF_DISTRIBUTION,
  STANDARDS_CONFLICT,
  type OverrideRow,
  type ViolationRow,
} from "./refinement-signals";

const NOW = new Date("2026-04-24T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function v(overrides: Partial<ViolationRow> = {}): ViolationRow {
  const base: ViolationRow = {
    checkEventId: "evt_1",
    standardId: "PRF-01",
    moment: "destructive_action",
    contentType: "confirmation",
    textHash: "hash_a",
    source: "mcp",
    reviewReasonSubtype: null,
    createdAt: new Date(NOW.getTime() - 1 * DAY),
  };
  return { ...base, ...overrides };
}

function o(overrides: Partial<OverrideRow> = {}): OverrideRow {
  const base: OverrideRow = {
    standardId: "PRF-01",
    overrideReasonCode: "standard_too_strict",
    userId: "user_a",
    actorRole: "designer",
    textHash: "hash_o1",
    createdAt: new Date(NOW.getTime() - 1 * DAY),
  };
  return { ...base, ...overrides };
}

describe("buildStandardSignals", () => {
  it("splits fires into 90d and 30d buckets", () => {
    const eightyDaysAgo = new Date(NOW.getTime() - 80 * DAY);
    const tenDaysAgo = new Date(NOW.getTime() - 10 * DAY);
    const signals = buildStandardSignals(
      [
        v({ standardId: "A", createdAt: eightyDaysAgo, checkEventId: "c1" }),
        v({ standardId: "A", createdAt: tenDaysAgo, checkEventId: "c2" }),
        v({ standardId: "A", createdAt: tenDaysAgo, checkEventId: "c3" }),
      ],
      [],
      NOW,
    );
    const a = signals.find((s) => s.standard_id === "A")!;
    expect(a.fires_90d).toBe(3);
    expect(a.fires_30d).toBe(2);
    expect(a.total_evaluations_90d).toBe(3);
  });

  it("counts overrides per standard", () => {
    const signals = buildStandardSignals(
      [v({ standardId: "A" })],
      [
        o({ standardId: "A" }),
        o({ standardId: "A" }),
        o({ standardId: "B" }),
      ],
      NOW,
    );
    const a = signals.find((s) => s.standard_id === "A")!;
    const b = signals.find((s) => s.standard_id === "B")!;
    expect(a.overrides_30d).toBe(2);
    expect(b.overrides_30d).toBe(1);
  });

  it("builds co-firing map and unique_fires_30d from check-event groups", () => {
    // evt_1: A + B co-fire. evt_2: A alone. evt_3: A + B + C co-fire.
    const signals = buildStandardSignals(
      [
        v({ standardId: "A", checkEventId: "evt_1" }),
        v({ standardId: "B", checkEventId: "evt_1" }),
        v({ standardId: "A", checkEventId: "evt_2" }),
        v({ standardId: "A", checkEventId: "evt_3" }),
        v({ standardId: "B", checkEventId: "evt_3" }),
        v({ standardId: "C", checkEventId: "evt_3" }),
      ],
      [],
      NOW,
    );
    const a = signals.find((s) => s.standard_id === "A")!;
    expect(a.unique_fires_30d).toBe(1); // only evt_2 was A-alone
    expect(a.co_firing_standards_30d).toEqual({ B: 2, C: 1 });

    const c = signals.find((s) => s.standard_id === "C")!;
    expect(c.unique_fires_30d).toBe(0);
    expect(c.co_firing_standards_30d).toEqual({ A: 1, B: 1 });
  });
});

describe("buildOverrideClusters", () => {
  it("buckets by (standard, reason_code) and dedupes actors", () => {
    const clusters = buildOverrideClusters([
      o({ standardId: "A", overrideReasonCode: "standard_too_strict", userId: "u1" }),
      o({ standardId: "A", overrideReasonCode: "standard_too_strict", userId: "u2" }),
      o({ standardId: "A", overrideReasonCode: "standard_too_strict", userId: "u1" }),
      o({ standardId: "A", overrideReasonCode: "shipping_anyway", userId: "u1" }),
    ]);
    expect(clusters).toHaveLength(2);
    const strict = clusters.find((c) => c.reason_code === "standard_too_strict")!;
    expect(strict.count_30d).toBe(3);
    expect(strict.distinct_actors).toBe(2);
  });

  it("skips overrides with no reason_code", () => {
    expect(
      buildOverrideClusters([o({ overrideReasonCode: null })]),
    ).toEqual([]);
  });

  it("caps sample text hashes", () => {
    const rows: OverrideRow[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(o({ textHash: `h${i}`, userId: `u${i}` }));
    }
    const [cluster] = buildOverrideClusters(rows, 3);
    expect(cluster!.sample_text_hashes.length).toBe(3);
  });

  it("orders by count descending", () => {
    const clusters = buildOverrideClusters([
      o({ standardId: "A", overrideReasonCode: "r1" }),
      o({ standardId: "B", overrideReasonCode: "r1" }),
      o({ standardId: "B", overrideReasonCode: "r1" }),
    ]);
    expect(clusters[0]!.standard_id).toBe("B");
  });
});

describe("buildOODClusters", () => {
  it("counts cases (checks), not violations, per (moment, content_type)", () => {
    const rows = [
      // One check with 3 OOD-tagged violations — counts as ONE case.
      v({
        checkEventId: "e1",
        moment: "X",
        contentType: "Y",
        reviewReasonSubtype: OUT_OF_DISTRIBUTION,
        textHash: "h1",
      }),
      v({
        checkEventId: "e1",
        moment: "X",
        contentType: "Y",
        reviewReasonSubtype: OUT_OF_DISTRIBUTION,
        textHash: "h1",
        standardId: "PRF-02",
      }),
      v({
        checkEventId: "e1",
        moment: "X",
        contentType: "Y",
        reviewReasonSubtype: OUT_OF_DISTRIBUTION,
        textHash: "h1",
        standardId: "PRF-03",
      }),
      // Another check, same cluster — ONE more case.
      v({
        checkEventId: "e2",
        moment: "X",
        contentType: "Y",
        reviewReasonSubtype: OUT_OF_DISTRIBUTION,
        textHash: "h2",
      }),
    ];
    const [cluster] = buildOODClusters(rows);
    expect(cluster!.case_count_60d).toBe(2);
    expect(cluster!.moment).toBe("X");
    expect(cluster!.content_type).toBe("Y");
  });

  it("tracks distinct sources per cluster", () => {
    const rows = [
      v({
        checkEventId: "e1",
        source: "mcp",
        reviewReasonSubtype: OUT_OF_DISTRIBUTION,
      }),
      v({
        checkEventId: "e2",
        source: "cli",
        reviewReasonSubtype: OUT_OF_DISTRIBUTION,
      }),
      v({
        checkEventId: "e3",
        source: "mcp",
        reviewReasonSubtype: OUT_OF_DISTRIBUTION,
      }),
    ];
    const [cluster] = buildOODClusters(rows);
    expect(cluster!.distinct_sources).toBe(2);
  });

  it("skips violations with other review reasons", () => {
    const rows = [
      v({ reviewReasonSubtype: "low_confidence", checkEventId: "e1" }),
      v({ reviewReasonSubtype: null, checkEventId: "e2" }),
    ];
    expect(buildOODClusters(rows)).toEqual([]);
  });
});

describe("buildConflictClusters", () => {
  it("requires at least two distinct standards on the same check", () => {
    const rows = [
      v({
        checkEventId: "e1",
        standardId: "A",
        reviewReasonSubtype: STANDARDS_CONFLICT,
      }),
    ];
    expect(buildConflictClusters(rows, NOW)).toEqual([]);
  });

  it("groups conflicts by sorted standard_ids tuple", () => {
    const rows = [
      v({
        checkEventId: "e1",
        standardId: "A",
        reviewReasonSubtype: STANDARDS_CONFLICT,
      }),
      v({
        checkEventId: "e1",
        standardId: "B",
        reviewReasonSubtype: STANDARDS_CONFLICT,
      }),
      v({
        checkEventId: "e2",
        standardId: "B",
        reviewReasonSubtype: STANDARDS_CONFLICT,
      }),
      v({
        checkEventId: "e2",
        standardId: "A",
        reviewReasonSubtype: STANDARDS_CONFLICT,
      }),
    ];
    const clusters = buildConflictClusters(rows, NOW);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.standard_ids).toEqual(["A", "B"]);
    expect(clusters[0]!.count_30d).toBe(2);
  });

  it("respects the 30-day window", () => {
    const fortyDaysAgo = new Date(NOW.getTime() - 40 * DAY);
    const rows = [
      v({
        checkEventId: "old",
        standardId: "A",
        reviewReasonSubtype: STANDARDS_CONFLICT,
        createdAt: fortyDaysAgo,
      }),
      v({
        checkEventId: "old",
        standardId: "B",
        reviewReasonSubtype: STANDARDS_CONFLICT,
        createdAt: fortyDaysAgo,
      }),
    ];
    expect(buildConflictClusters(rows, NOW)).toEqual([]);
  });
});

describe("buildSignalDump", () => {
  it("assembles all four sections and passes through first_seen", () => {
    const dump = buildSignalDump({
      now: NOW,
      violations90d: [v({ standardId: "A" })],
      overrides30d: [o({ standardId: "A" })],
      reviewViolations60d: [],
      standardFirstSeen: { A: "2025-12-01T00:00:00Z" },
    });
    expect(dump.generated_at).toBe(NOW.toISOString());
    expect(dump.standards.length).toBeGreaterThan(0);
    expect(dump.override_clusters.length).toBeGreaterThan(0);
    expect(dump.ood_clusters).toEqual([]);
    expect(dump.conflict_clusters).toEqual([]);
    expect(dump.standard_first_seen).toEqual({ A: "2025-12-01T00:00:00Z" });
  });
});
