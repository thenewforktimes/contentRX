import { describe, expect, it } from "vitest";
import { MOMENTS } from "./engine-taxonomy";
import {
  MOMENT_DESCRIPTIONS,
  SITUATION_PROPERTY_BY_MOMENT,
  summarizeMomentBanner,
} from "./moment-metadata";

/**
 * Client-safe moment-metadata tests. The Python-side test in
 * `tests/test_moment_metadata_ts_mirror.py` pins the TS `MOMENT_DESCRIPTIONS`
 * against `moments.py`; these tests cover the purely local shape (full
 * coverage of the 13 moments, summarizeMomentBanner behaviour).
 *
 * Human-eval build plan Session 22.
 */

describe("MOMENT_DESCRIPTIONS", () => {
  it("has an entry for every canonical moment", () => {
    for (const m of MOMENTS) {
      expect(MOMENT_DESCRIPTIONS[m], `description for ${m}`).toBeTypeOf(
        "string",
      );
      expect(MOMENT_DESCRIPTIONS[m].length).toBeGreaterThan(10);
    }
  });

  it("has exactly 13 entries (no extras, no gaps)", () => {
    expect(Object.keys(MOMENT_DESCRIPTIONS).sort()).toEqual(
      [...MOMENTS].sort(),
    );
  });
});

describe("SITUATION_PROPERTY_BY_MOMENT", () => {
  it("flags exactly the three situation-bearing moments", () => {
    expect(Object.keys(SITUATION_PROPERTY_BY_MOMENT).sort()).toEqual([
      "compliance_disclosure",
      "destructive_action",
      "trust_permission",
    ]);
  });

  it("maps to the expected human-readable label", () => {
    expect(SITUATION_PROPERTY_BY_MOMENT.destructive_action).toBe(
      "destructive",
    );
    expect(SITUATION_PROPERTY_BY_MOMENT.trust_permission).toBe(
      "permission-gated",
    );
    expect(SITUATION_PROPERTY_BY_MOMENT.compliance_disclosure).toBe(
      "compliance",
    );
  });
});

describe("summarizeMomentBanner", () => {
  it("returns null for a null summary", () => {
    expect(summarizeMomentBanner("task_execution", null)).toBeNull();
  });

  it("returns null when there are no weighted standards", () => {
    expect(
      summarizeMomentBanner("empty_state", {
        total: 0,
        emphasized: 0,
        relaxed: 0,
        suppressed: 0,
      }),
    ).toBeNull();
  });

  it("formats non-zero counts and skips zero categories", () => {
    expect(
      summarizeMomentBanner("first_encounter", {
        total: 5,
        emphasized: 4,
        relaxed: 1,
        suppressed: 0,
      }),
    ).toBe("Looks like first_encounter — 4 emphasized, 1 relaxed.");
  });

  it("renders all three categories when all are non-zero", () => {
    expect(
      summarizeMomentBanner("decision_point", {
        total: 5,
        emphasized: 4,
        relaxed: 0,
        suppressed: 1,
      }),
    ).toBe("Looks like decision_point — 4 emphasized, 1 suppressed.");
  });
});
