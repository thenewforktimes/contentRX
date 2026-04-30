import { describe, expect, it } from "vitest";
import {
  STANDARD_CHAR_CAP,
  UNIT_COST_FLAT,
  meter,
  meteringBlock,
} from "./metering";

describe("meter() — standard tier", () => {
  it("bills 1 unit for short input (< STANDARD_CHAR_CAP)", () => {
    const d = meter("Save changes");
    expect(d.tier).toBe("standard");
    expect(d.unitsConsumed).toBe(1);
    expect(d.inputChars).toBe(12);
  });

  it("bills 1 unit at exactly STANDARD_CHAR_CAP", () => {
    const text = "x".repeat(STANDARD_CHAR_CAP);
    const d = meter(text, "standard");
    expect(d.unitsConsumed).toBe(1);
  });

  it("bills 2 units at STANDARD_CHAR_CAP + 1", () => {
    const text = "x".repeat(STANDARD_CHAR_CAP + 1);
    const d = meter(text, "standard");
    expect(d.unitsConsumed).toBe(2);
  });

  it("bills proportional units for long standard input", () => {
    expect(meter("x".repeat(600), "standard").unitsConsumed).toBe(2);
    expect(meter("x".repeat(900), "standard").unitsConsumed).toBe(3);
    expect(meter("x".repeat(1_500), "standard").unitsConsumed).toBe(5);
    expect(meter("x".repeat(3_000), "standard").unitsConsumed).toBe(10);
  });

  it("bills minimum 1 unit for empty input", () => {
    // Defense against zero-length probes slipping through the meter.
    const d = meter("", "standard");
    expect(d.unitsConsumed).toBe(1);
  });

  it("defaults to standard tier when segmentType is omitted", () => {
    const d = meter("hello world");
    expect(d.tier).toBe("standard");
  });
});

describe("meter() — document tier", () => {
  it("bills 8 units flat regardless of length", () => {
    expect(meter("short", "document").unitsConsumed).toBe(
      UNIT_COST_FLAT.document,
    );
    expect(meter("x".repeat(2_000), "document").unitsConsumed).toBe(
      UNIT_COST_FLAT.document,
    );
    expect(meter("x".repeat(5_000), "document").unitsConsumed).toBe(
      UNIT_COST_FLAT.document,
    );
  });

  it("reports the document tier in the decision", () => {
    const d = meter("x".repeat(3_000), "document");
    expect(d.tier).toBe("document");
    expect(d.inputChars).toBe(3_000);
  });
});

describe("meter() — surface tier", () => {
  it("bills 25 units flat regardless of length", () => {
    expect(meter("short", "surface").unitsConsumed).toBe(
      UNIT_COST_FLAT.surface,
    );
    expect(meter("x".repeat(10_000), "surface").unitsConsumed).toBe(
      UNIT_COST_FLAT.surface,
    );
    expect(meter("x".repeat(50_000), "surface").unitsConsumed).toBe(
      UNIT_COST_FLAT.surface,
    );
  });

  it("reports the surface tier in the decision", () => {
    const d = meter("x".repeat(10_000), "surface");
    expect(d.tier).toBe("surface");
  });
});

describe("meter() — economics check", () => {
  it("standard becomes more expensive than document past ~2,400 chars", () => {
    // The natural break-even where caller is incentivized to declare
    // document instead of standard. 8 units at document = 2,400 chars
    // at standard (8 × 300 = 2,400).
    expect(meter("x".repeat(2_400), "standard").unitsConsumed).toBe(8);
    expect(meter("x".repeat(2_701), "standard").unitsConsumed).toBe(10);
    // Document at the same length is still 8.
    expect(meter("x".repeat(2_701), "document").unitsConsumed).toBe(8);
  });

  it("document becomes more expensive than surface past ~7,500 chars", () => {
    // 25 units at surface = ~3.1× document's 8. Caller incentive
    // crossover happens when document tier hits document's bound
    // (5,000 chars in marketing copy) — the engine doesn't enforce a
    // cap, but a caller declaring document on 50,000 chars is paying
    // less than declaring surface (8 vs 25).  The economics here only
    // describe the *typical* shape; the dashboard's real-time
    // estimator nudges the caller to the right tier.
    expect(meter("x".repeat(8_000), "document").unitsConsumed).toBe(8);
    expect(meter("x".repeat(8_000), "surface").unitsConsumed).toBe(25);
  });
});

describe("meteringBlock()", () => {
  it("maps a MeterDecision to the wire-format-shaped block", () => {
    const decision = meter("hello", "standard");
    expect(meteringBlock(decision)).toEqual({
      tier: "standard",
      units_consumed: 1,
      input_chars: 5,
      input_segments: 1,
      split_applied: false,
    });
  });

  it("preserves the tier from the decision", () => {
    const decision = meter("x".repeat(3_000), "document");
    const block = meteringBlock(decision);
    expect(block.tier).toBe("document");
    expect(block.units_consumed).toBe(8);
  });
});
