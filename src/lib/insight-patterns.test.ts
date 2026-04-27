/**
 * Unit tests for the pure-logic primitives in insight-patterns:
 * `buildPatterns` (threshold gates) and `momentLabel` (display map).
 *
 * The DB-touching helper `loadFindingAggregates` is exercised via the
 * dashboard render path — covered there rather than re-instantiating
 * a pglite harness for one query trio.
 */

import { describe, expect, it } from "vitest";
import {
  buildPatterns,
  momentLabel,
  type FindingAggregates,
} from "./insight-patterns";

const empty: FindingAggregates = {
  topMoment: null,
  topFile: null,
  highCount: 0,
};

describe("buildPatterns — total floor", () => {
  it("returns no patterns when total findings < 5", () => {
    const aggs: FindingAggregates = {
      topMoment: { moment: "confirmation", count: 4 },
      topFile: { filePath: "src/Foo.tsx", count: 4 },
      highCount: 4,
    };
    expect(buildPatterns(aggs, 4)).toEqual([]);
  });

  it("returns no patterns for an empty week", () => {
    expect(buildPatterns(empty, 0)).toEqual([]);
  });

  it("starts emitting patterns at total = 5", () => {
    const aggs: FindingAggregates = {
      topMoment: { moment: "confirmation", count: 5 },
      topFile: null,
      highCount: 0,
    };
    expect(buildPatterns(aggs, 5)).toHaveLength(1);
  });
});

describe("buildPatterns — moment concentration", () => {
  it("emits when share ≥ 20%", () => {
    const aggs: FindingAggregates = {
      topMoment: { moment: "destructive_action", count: 4 },
      topFile: null,
      highCount: 0,
    };
    const out = buildPatterns(aggs, 20);
    expect(out).toEqual([
      {
        kind: "moment-concentration",
        moment: "destructive_action",
        momentLabel: "Destructive actions",
        count: 4,
        sharePct: 20,
      },
    ]);
  });

  it("does not emit when share < 20%", () => {
    const aggs: FindingAggregates = {
      topMoment: { moment: "confirmation", count: 4 },
      topFile: null,
      highCount: 0,
    };
    expect(buildPatterns(aggs, 21)).toEqual([]);
  });

  it("does not emit when topMoment is null (no findings had a moment)", () => {
    const aggs: FindingAggregates = {
      topMoment: null,
      topFile: null,
      highCount: 0,
    };
    expect(buildPatterns(aggs, 100)).toEqual([]);
  });

  it("rounds sharePct to one decimal", () => {
    const aggs: FindingAggregates = {
      topMoment: { moment: "confirmation", count: 7 },
      topFile: null,
      highCount: 0,
    };
    // 7/30 = 0.2333... → 23.3%
    const out = buildPatterns(aggs, 30);
    expect(out[0].kind).toBe("moment-concentration");
    if (out[0].kind === "moment-concentration") {
      expect(out[0].sharePct).toBe(23.3);
    }
  });
});

describe("buildPatterns — file hotspot", () => {
  it("emits when one file has ≥ 3 findings", () => {
    const aggs: FindingAggregates = {
      topMoment: null,
      topFile: { filePath: "src/CheckoutForm.tsx", count: 3 },
      highCount: 0,
    };
    const out = buildPatterns(aggs, 10);
    expect(out).toEqual([
      {
        kind: "file-hotspot",
        filePath: "src/CheckoutForm.tsx",
        count: 3,
      },
    ]);
  });

  it("does not emit at count = 2", () => {
    const aggs: FindingAggregates = {
      topMoment: null,
      topFile: { filePath: "src/CheckoutForm.tsx", count: 2 },
      highCount: 0,
    };
    expect(buildPatterns(aggs, 10)).toEqual([]);
  });

  it("does not emit when topFile is null (no findings had a file path)", () => {
    const aggs: FindingAggregates = {
      topMoment: null,
      topFile: null,
      highCount: 0,
    };
    expect(buildPatterns(aggs, 10)).toEqual([]);
  });
});

describe("buildPatterns — severity skew", () => {
  it("emits when high-severity ≥ 3 AND share ≥ 25%", () => {
    const aggs: FindingAggregates = {
      topMoment: null,
      topFile: null,
      highCount: 3,
    };
    const out = buildPatterns(aggs, 10); // 30%
    expect(out).toEqual([
      {
        kind: "severity-skew",
        highCount: 3,
        total: 10,
        sharePct: 30,
      },
    ]);
  });

  it("does not emit when count < 3", () => {
    const aggs: FindingAggregates = {
      topMoment: null,
      topFile: null,
      highCount: 2,
    };
    expect(buildPatterns(aggs, 5)).toEqual([]);
  });

  it("does not emit when share < 25% even with high count", () => {
    const aggs: FindingAggregates = {
      topMoment: null,
      topFile: null,
      highCount: 4,
    };
    expect(buildPatterns(aggs, 100)).toEqual([]);
  });
});

describe("buildPatterns — multiple patterns", () => {
  it("returns moment, file, and severity patterns when all thresholds met", () => {
    const aggs: FindingAggregates = {
      topMoment: { moment: "destructive_action", count: 8 },
      topFile: { filePath: "src/CheckoutForm.tsx", count: 5 },
      highCount: 8,
    };
    const out = buildPatterns(aggs, 20);
    expect(out).toHaveLength(3);
    expect(out.map((p) => p.kind)).toEqual([
      "moment-concentration",
      "file-hotspot",
      "severity-skew",
    ]);
  });
});

describe("momentLabel", () => {
  it("returns the curated label for a known moment", () => {
    expect(momentLabel("destructive_action")).toBe("Destructive actions");
    expect(momentLabel("confirmation")).toBe("Confirmations");
    expect(momentLabel("empty_state")).toBe("Empty states");
    expect(momentLabel("trust_permission")).toBe("Trust & permission");
  });

  it("falls back to a humanized form for unknown moments", () => {
    expect(momentLabel("unknown_moment_id")).toBe("unknown moment id");
  });

  it("returns the input when there are no underscores to replace", () => {
    expect(momentLabel("oddmoment")).toBe("oddmoment");
  });
});
