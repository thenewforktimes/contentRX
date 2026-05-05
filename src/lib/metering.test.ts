import { describe, expect, it } from "vitest";
import {
  UNIT_WINDOW,
  isLargeInput,
  meter,
  meteringBlock,
} from "./metering";

describe("meter() — small inputs", () => {
  it("bills 1 unit for short input", () => {
    const d = meter("Save changes");
    expect(d.sizeClass).toBe("small");
    expect(d.unitsConsumed).toBe(1);
    expect(d.inputChars).toBe(12);
  });

  it("bills 1 unit at exactly UNIT_WINDOW (boundary)", () => {
    const text = "x".repeat(UNIT_WINDOW);
    const d = meter(text);
    expect(d.sizeClass).toBe("small");
    expect(d.unitsConsumed).toBe(1);
  });

  it("bills minimum 1 unit for empty input", () => {
    const d = meter("");
    expect(d.unitsConsumed).toBe(1);
    expect(d.sizeClass).toBe("small");
  });
});

describe("meter() — large inputs (proportional billing)", () => {
  it("bills 2 units at UNIT_WINDOW + 1 (boundary)", () => {
    const d = meter("x".repeat(UNIT_WINDOW + 1));
    expect(d.sizeClass).toBe("large");
    expect(d.unitsConsumed).toBe(2);
  });

  it("bills 1 unit per UNIT_WINDOW characters, rounded up", () => {
    expect(meter("x".repeat(201)).unitsConsumed).toBe(2);
    expect(meter("x".repeat(400)).unitsConsumed).toBe(2);
    expect(meter("x".repeat(401)).unitsConsumed).toBe(3);
    expect(meter("x".repeat(1_000)).unitsConsumed).toBe(5);
    expect(meter("x".repeat(4_000)).unitsConsumed).toBe(20);
    expect(meter("x".repeat(4_775)).unitsConsumed).toBe(24);
  });

  it("classifies as 'large' for any input above the window", () => {
    expect(meter("x".repeat(UNIT_WINDOW + 1)).sizeClass).toBe("large");
    expect(meter("x".repeat(50_000)).sizeClass).toBe("large");
  });
});

describe("meteringBlock()", () => {
  it("maps a small-input MeterDecision to the wire-format block", () => {
    const decision = meter("hello");
    expect(meteringBlock(decision)).toEqual({
      size_class: "small",
      units_consumed: 1,
      input_chars: 5,
      input_segments: 1,
      split_applied: false,
    });
  });

  it("maps a large-input MeterDecision to the wire-format block", () => {
    const decision = meter("x".repeat(1_000));
    expect(meteringBlock(decision)).toEqual({
      size_class: "large",
      units_consumed: 5,
      input_chars: 1_000,
      input_segments: 1,
      split_applied: false,
    });
  });
});

describe("isLargeInput()", () => {
  it("returns false at-or-below the unit window", () => {
    expect(isLargeInput("")).toBe(false);
    expect(isLargeInput("Save changes")).toBe(false);
    expect(isLargeInput("x".repeat(UNIT_WINDOW))).toBe(false);
  });

  it("returns true above the unit window", () => {
    expect(isLargeInput("x".repeat(UNIT_WINDOW + 1))).toBe(true);
    expect(isLargeInput("x".repeat(4_775))).toBe(true);
  });
});
