import { describe, expect, it } from "vitest";
import {
  buildPreferenceSignals,
  calibrateConfidence,
  PAIRS_PER_SESSION,
  SESSION_COOLDOWN_DAYS,
  selectSessionPairs,
  shouldPrompt,
  signalsToPrecedentCounts,
  stableHash,
  type PairWithResponses,
} from "./preferences";
import type { PreferencePair } from "@/db/schema";

function pair(overrides: Partial<PreferencePair> = {}): PreferencePair {
  const base: PreferencePair = {
    id: "pair_1",
    seedKey: "seed_1",
    moment: "destructive_action",
    contentType: "confirmation",
    standardId: "PRF-01",
    leftText: "Delete account",
    rightText: "Are you sure?",
    expectedPreferred: "left",
    prompt: null,
    retiredAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
  return { ...base, ...overrides };
}

describe("shouldPrompt", () => {
  const now = new Date("2026-04-24T12:00:00Z");

  it("returns opted_out when opt-out timestamp is set", () => {
    expect(
      shouldPrompt({
        optedOutAt: new Date("2026-04-01"),
        lastAnsweredAt: null,
        now,
      }),
    ).toEqual({ eligible: false, reason: "opted_out" });
  });

  it("returns never_answered for brand-new users", () => {
    expect(
      shouldPrompt({ optedOutAt: null, lastAnsweredAt: null, now }),
    ).toEqual({ eligible: true, reason: "never_answered" });
  });

  it("returns cooldown_active when last answer is within window", () => {
    const lastAnsweredAt = new Date("2026-04-20T12:00:00Z"); // 4 days ago
    const gate = shouldPrompt({ optedOutAt: null, lastAnsweredAt, now });
    expect(gate.eligible).toBe(false);
    expect(gate.reason).toBe("cooldown_active");
    if (gate.reason === "cooldown_active") {
      expect(gate.nextEligibleAt?.toISOString()).toBe(
        "2026-04-27T12:00:00.000Z",
      );
    }
  });

  it("returns cooldown_elapsed at exactly the window boundary", () => {
    const lastAnsweredAt = new Date(
      now.getTime() - SESSION_COOLDOWN_DAYS * 24 * 3600 * 1000,
    );
    expect(
      shouldPrompt({ optedOutAt: null, lastAnsweredAt, now }),
    ).toEqual({ eligible: true, reason: "cooldown_elapsed" });
  });

  it("respects a custom cooldown window", () => {
    const lastAnsweredAt = new Date("2026-04-22T12:00:00Z");
    expect(
      shouldPrompt({
        optedOutAt: null,
        lastAnsweredAt,
        now,
        cooldownDays: 1,
      }),
    ).toEqual({ eligible: true, reason: "cooldown_elapsed" });
  });
});

describe("selectSessionPairs", () => {
  it("excludes retired and seen pairs", () => {
    const pairs = [
      pair({ id: "a", seedKey: "a" }),
      pair({ id: "b", seedKey: "b", retiredAt: new Date("2026-02-01") }),
      pair({ id: "c", seedKey: "c" }),
    ];
    const picked = selectSessionPairs({
      availablePairs: pairs,
      seenPairIds: ["a"],
      seed: "user_1",
    });
    expect(picked.map((p) => p.id)).toEqual(["c"]);
  });

  it("defaults to PAIRS_PER_SESSION pairs when pool is large", () => {
    const pairs = Array.from({ length: 10 }, (_, i) =>
      pair({ id: `p${i}`, seedKey: `p${i}` }),
    );
    const picked = selectSessionPairs({
      availablePairs: pairs,
      seenPairIds: [],
      seed: "user_1",
    });
    expect(picked).toHaveLength(PAIRS_PER_SESSION);
  });

  it("prioritizes pairs with lower precedent count first", () => {
    const pairs = [
      pair({ id: "high", seedKey: "h", standardId: "STD-A", contentType: "ct_a" }),
      pair({ id: "low", seedKey: "l", standardId: "STD-B", contentType: "ct_b" }),
      pair({ id: "mid", seedKey: "m", standardId: "STD-C", contentType: "ct_c" }),
    ];
    const picked = selectSessionPairs({
      availablePairs: pairs,
      seenPairIds: [],
      precedentCounts: {
        "STD-A|ct_a": 10,
        "STD-B|ct_b": 0,
        "STD-C|ct_c": 3,
      },
      seed: "user_1",
      limit: 2,
    });
    expect(picked.map((p) => p.id)).toEqual(["low", "mid"]);
  });

  it("is deterministic for the same seed", () => {
    const pairs = Array.from({ length: 6 }, (_, i) =>
      pair({ id: `p${i}`, seedKey: `p${i}` }),
    );
    const a = selectSessionPairs({
      availablePairs: pairs,
      seenPairIds: [],
      seed: "user_1",
    });
    const b = selectSessionPairs({
      availablePairs: pairs,
      seenPairIds: [],
      seed: "user_1",
    });
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
  });

  it("yields different orderings for different seeds", () => {
    const pairs = Array.from({ length: 6 }, (_, i) =>
      pair({ id: `p${i}`, seedKey: `p${i}` }),
    );
    const a = selectSessionPairs({
      availablePairs: pairs,
      seenPairIds: [],
      seed: "user_a",
    });
    const b = selectSessionPairs({
      availablePairs: pairs,
      seenPairIds: [],
      seed: "user_z_different",
    });
    // With 6 identical-priority pairs, different seeds should produce
    // at least one different pick within the top 3.
    expect(a.map((p) => p.id)).not.toEqual(b.map((p) => p.id));
  });
});

describe("stableHash", () => {
  it("returns a 32-bit unsigned integer", () => {
    const h = stableHash("hello");
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });

  it("is stable for identical input", () => {
    expect(stableHash("abc")).toBe(stableHash("abc"));
  });

  it("differs for different input", () => {
    expect(stableHash("abc")).not.toBe(stableHash("abd"));
  });
});

describe("buildPreferenceSignals", () => {
  it("counts aligned vs conflicting based on expected_preferred", () => {
    const data: PairWithResponses[] = [
      {
        pair: pair({
          id: "a",
          standardId: "PRF-01",
          contentType: "confirmation",
          expectedPreferred: "left",
        }),
        responses: [
          { preferred: "left" }, // aligned
          { preferred: "left" }, // aligned
          { preferred: "right" }, // conflicting
          { preferred: "neither" },
        ],
      },
    ];
    const signals = buildPreferenceSignals(data);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toEqual({
      key: "PRF-01|confirmation|pass",
      aligned: 2,
      conflicting: 1,
      neither: 1,
    });
  });

  it("groups responses across pairs sharing (standard, content_type)", () => {
    const data: PairWithResponses[] = [
      {
        pair: pair({ id: "a", standardId: "X", contentType: "t", expectedPreferred: "left" }),
        responses: [{ preferred: "left" }],
      },
      {
        pair: pair({ id: "b", standardId: "X", contentType: "t", expectedPreferred: "right" }),
        responses: [{ preferred: "right" }],
      },
    ];
    const signals = buildPreferenceSignals(data);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aligned).toBe(2);
  });

  it("counts pairs without expected_preferred toward 'neither'", () => {
    const data: PairWithResponses[] = [
      {
        pair: pair({ id: "a", standardId: "X", contentType: "t", expectedPreferred: null }),
        responses: [{ preferred: "left" }, { preferred: "right" }],
      },
    ];
    const signals = buildPreferenceSignals(data);
    expect(signals[0]).toMatchObject({ aligned: 0, conflicting: 0, neither: 2 });
  });
});

describe("signalsToPrecedentCounts", () => {
  it("emits only aligned counts and skips empty keys", () => {
    const counts = signalsToPrecedentCounts([
      { key: "A|t|pass", aligned: 4, conflicting: 1, neither: 0 },
      { key: "B|t|pass", aligned: 0, conflicting: 2, neither: 1 },
    ]);
    expect(counts).toEqual({ "A|t|pass": 4 });
  });
});

describe("calibrateConfidence", () => {
  it("keeps high when annotations dominate and preferences are absent", () => {
    expect(calibrateConfidence({ annotationCount: 5 })).toBe("high");
  });

  it("downgrades high to medium when preference conflict dominates", () => {
    expect(
      calibrateConfidence({
        annotationCount: 4,
        preferenceSignal: {
          key: "x",
          aligned: 1,
          conflicting: 3,
          neither: 0,
        },
      }),
    ).toBe("medium");
  });

  it("upgrades medium to high with strong preference alignment", () => {
    expect(
      calibrateConfidence({
        annotationCount: 2,
        preferenceSignal: {
          key: "x",
          aligned: 3,
          conflicting: 0,
          neither: 0,
        },
      }),
    ).toBe("high");
  });

  it("downgrades medium to low when conflict dominates", () => {
    expect(
      calibrateConfidence({
        annotationCount: 1,
        preferenceSignal: {
          key: "x",
          aligned: 0,
          conflicting: 3,
          neither: 0,
        },
      }),
    ).toBe("low");
  });

  it("keeps zero-annotation at low without preferences", () => {
    expect(calibrateConfidence({ annotationCount: 0 })).toBe("low");
  });

  it("upgrades zero-annotation to medium with strong preferences", () => {
    expect(
      calibrateConfidence({
        annotationCount: 0,
        preferenceSignal: {
          key: "x",
          aligned: 4,
          conflicting: 0,
          neither: 0,
        },
      }),
    ).toBe("medium");
  });
});
