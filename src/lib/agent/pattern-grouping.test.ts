import { describe, expect, it } from "vitest";
import {
  digestHeaderVariant,
  groupByPattern,
  isolatedFlags,
  patternsOfTwoOrMore,
  topNPatterns,
  type ViolationSummary,
} from "./pattern-grouping";

/**
 * Pattern-grouping tests (Phase G2, 2026-05-09 roadmap).
 *
 * The grouping is deterministic: same input produces same output.
 * That property is load-bearing for the V1 agent's trust math, so
 * tests pin the ordering rule, the bucket counts, the boundary
 * cases (empty input, all isolated, all clustered).
 */

function v(
  standardId: string,
  severity: "high" | "medium" | "low",
  createdAt: string,
): ViolationSummary {
  return { standardId, severity, createdAt: new Date(createdAt) };
}

describe("groupByPattern", () => {
  it("returns empty for an empty input", () => {
    expect(groupByPattern([])).toEqual([]);
  });

  it("clusters violations sharing the same standardId", () => {
    const result = groupByPattern([
      v("ACT-01", "medium", "2026-05-01T10:00:00Z"),
      v("ACT-01", "medium", "2026-05-02T10:00:00Z"),
      v("ACT-01", "high", "2026-05-03T10:00:00Z"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.standardId).toBe("ACT-01");
    expect(result[0]!.count).toBe(3);
    expect(result[0]!.severityCounts).toEqual({ high: 1, medium: 2, low: 0 });
  });

  it("tracks the most recent occurrence as lastSeen", () => {
    const result = groupByPattern([
      v("CLR-01", "low", "2026-05-01T10:00:00Z"),
      v("CLR-01", "low", "2026-05-05T10:00:00Z"),
      v("CLR-01", "low", "2026-05-03T10:00:00Z"),
    ]);
    expect(result[0]!.lastSeen.toISOString()).toBe(
      "2026-05-05T10:00:00.000Z",
    );
  });

  it("sorts by count descending — biggest patterns first", () => {
    const result = groupByPattern([
      v("RARE-01", "low", "2026-05-01T10:00:00Z"),
      v("BIG-01", "medium", "2026-05-01T10:00:00Z"),
      v("BIG-01", "medium", "2026-05-02T10:00:00Z"),
      v("BIG-01", "medium", "2026-05-03T10:00:00Z"),
      v("MID-01", "high", "2026-05-01T10:00:00Z"),
      v("MID-01", "high", "2026-05-02T10:00:00Z"),
    ]);
    expect(result.map((p) => p.standardId)).toEqual([
      "BIG-01",
      "MID-01",
      "RARE-01",
    ]);
  });

  it("breaks count ties by most-recent occurrence descending", () => {
    const result = groupByPattern([
      v("OLDER-01", "medium", "2026-05-01T10:00:00Z"),
      v("OLDER-01", "medium", "2026-05-02T10:00:00Z"),
      v("NEWER-01", "medium", "2026-05-04T10:00:00Z"),
      v("NEWER-01", "medium", "2026-05-05T10:00:00Z"),
    ]);
    // Both have count=2; NEWER-01's lastSeen is more recent, so
    // it sorts first.
    expect(result.map((p) => p.standardId)).toEqual([
      "NEWER-01",
      "OLDER-01",
    ]);
  });

  it("breaks count + recency ties by standardId ascending (full determinism)", () => {
    // Same count, same lastSeen — falls back to standardId order.
    const result = groupByPattern([
      v("ZULU-01", "medium", "2026-05-01T10:00:00Z"),
      v("ZULU-01", "medium", "2026-05-02T10:00:00Z"),
      v("ALPHA-01", "medium", "2026-05-01T10:00:00Z"),
      v("ALPHA-01", "medium", "2026-05-02T10:00:00Z"),
    ]);
    expect(result.map((p) => p.standardId)).toEqual([
      "ALPHA-01",
      "ZULU-01",
    ]);
  });

  it("is deterministic — same input produces the same output across runs", () => {
    const input: ViolationSummary[] = [
      v("STD-A", "medium", "2026-05-01T10:00:00Z"),
      v("STD-A", "medium", "2026-05-02T10:00:00Z"),
      v("STD-B", "high", "2026-05-03T10:00:00Z"),
    ];
    const a = groupByPattern(input);
    const b = groupByPattern(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("topNPatterns", () => {
  it("returns the first n patterns by the canonical sort", () => {
    const result = topNPatterns(
      [
        v("X-1", "medium", "2026-05-01T10:00:00Z"),
        v("X-2", "medium", "2026-05-01T10:00:00Z"),
        v("X-2", "medium", "2026-05-02T10:00:00Z"),
        v("X-3", "medium", "2026-05-01T10:00:00Z"),
        v("X-3", "medium", "2026-05-02T10:00:00Z"),
        v("X-3", "medium", "2026-05-03T10:00:00Z"),
        v("X-4", "medium", "2026-05-01T10:00:00Z"),
      ],
      2,
    );
    expect(result.map((p) => p.standardId)).toEqual(["X-3", "X-2"]);
  });

  it("defaults to n=3 (matches the digest lead block)", () => {
    const violations: ViolationSummary[] = Array.from({ length: 5 }, (_, i) =>
      v(`STD-${i}`, "low", "2026-05-01T10:00:00Z"),
    );
    expect(topNPatterns(violations)).toHaveLength(3);
  });

  it("returns fewer when input has fewer patterns", () => {
    expect(
      topNPatterns([v("STD-1", "low", "2026-05-01T10:00:00Z")], 3),
    ).toHaveLength(1);
  });
});

describe("patternsOfTwoOrMore", () => {
  it("excludes singleton occurrences", () => {
    const result = patternsOfTwoOrMore([
      v("PAIR", "medium", "2026-05-01T10:00:00Z"),
      v("PAIR", "medium", "2026-05-02T10:00:00Z"),
      v("LONELY", "low", "2026-05-01T10:00:00Z"),
    ]);
    expect(result.map((p) => p.standardId)).toEqual(["PAIR"]);
  });
});

describe("isolatedFlags", () => {
  it("returns only standards with exactly one occurrence", () => {
    const result = isolatedFlags([
      v("PAIR", "medium", "2026-05-01T10:00:00Z"),
      v("PAIR", "medium", "2026-05-02T10:00:00Z"),
      v("LONELY", "low", "2026-05-01T10:00:00Z"),
    ]);
    expect(result.map((p) => p.standardId)).toEqual(["LONELY"]);
  });
});

describe("digestHeaderVariant", () => {
  it("returns 'empty' for 0-1 flags total (setup-prompt PR variant)", () => {
    expect(digestHeaderVariant([])).toBe("empty");
    expect(
      digestHeaderVariant([v("STD-1", "low", "2026-05-01T10:00:00Z")]),
    ).toBe("empty");
  });

  it("returns 'no-repetition' for 2-3 flags with no pattern", () => {
    expect(
      digestHeaderVariant([
        v("STD-A", "medium", "2026-05-01T10:00:00Z"),
        v("STD-B", "medium", "2026-05-02T10:00:00Z"),
        v("STD-C", "medium", "2026-05-03T10:00:00Z"),
      ]),
    ).toBe("no-repetition");
  });

  it("returns 'drift' when patterns of 2+ exist and nothing else", () => {
    expect(
      digestHeaderVariant([
        v("STD-A", "medium", "2026-05-01T10:00:00Z"),
        v("STD-A", "medium", "2026-05-02T10:00:00Z"),
        v("STD-A", "medium", "2026-05-03T10:00:00Z"),
      ]),
    ).toBe("drift");
  });

  it("returns 'mixed' when patterns and isolated flags coexist", () => {
    expect(
      digestHeaderVariant([
        v("STD-A", "medium", "2026-05-01T10:00:00Z"),
        v("STD-A", "medium", "2026-05-02T10:00:00Z"),
        v("STD-B", "low", "2026-05-03T10:00:00Z"),
      ]),
    ).toBe("mixed");
  });

  it("is deterministic over the same input", () => {
    const violations: ViolationSummary[] = [
      v("STD-A", "medium", "2026-05-01T10:00:00Z"),
      v("STD-A", "medium", "2026-05-02T10:00:00Z"),
      v("STD-B", "low", "2026-05-03T10:00:00Z"),
    ];
    const a = digestHeaderVariant(violations);
    const b = digestHeaderVariant(violations);
    expect(a).toBe(b);
  });
});
