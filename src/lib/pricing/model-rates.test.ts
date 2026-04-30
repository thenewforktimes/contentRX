import { describe, expect, it } from "vitest";
import { estimateCostUsd, rateFor } from "./model-rates";

describe("rateFor()", () => {
  it("returns Haiku rates for known Haiku model ids", () => {
    expect(rateFor("claude-haiku-4-5")).toEqual({
      inputUsd: 1,
      outputUsd: 5,
    });
  });

  it("returns Sonnet rates for known Sonnet model ids", () => {
    expect(rateFor("claude-sonnet-4-6")).toEqual({
      inputUsd: 3,
      outputUsd: 15,
    });
  });

  it("falls back to Sonnet rates for unknown models", () => {
    // Conservative fallback — over-estimating spend on an unknown
    // model is better than false-allowing a runaway.
    expect(rateFor("claude-future-5-0")).toEqual({
      inputUsd: 3,
      outputUsd: 15,
    });
  });

  it("falls back when modelId is null or undefined", () => {
    expect(rateFor(null)).toEqual({ inputUsd: 3, outputUsd: 15 });
    expect(rateFor(undefined)).toEqual({ inputUsd: 3, outputUsd: 15 });
  });
});

describe("estimateCostUsd()", () => {
  it("computes cost from input + output tokens at the model's rate", () => {
    // 1,000 input + 100 output on Haiku = $0.001 + $0.0005 = $0.0015
    const cost = estimateCostUsd({
      modelId: "claude-haiku-4-5",
      inputTokens: 1_000,
      outputTokens: 100,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    });
    expect(cost).toBeCloseTo(0.0015, 6);
  });

  it("applies cache-read at 10% of base input rate", () => {
    // 10,000 cache-read tokens at Haiku 0.1× = 0.0001 / 1k tokens
    // Total: $0.0001 (Haiku input rate $1/MTok × 0.1 × 10000/1M)
    const cost = estimateCostUsd({
      modelId: "claude-haiku-4-5",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 10_000,
      cacheCreationInputTokens: 0,
    });
    expect(cost).toBeCloseTo(0.001, 6);
  });

  it("applies cache-creation at 125% of base input rate", () => {
    // 1,000 cache-write tokens at Haiku × 1.25 = $0.00125
    const cost = estimateCostUsd({
      modelId: "claude-haiku-4-5",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 1_000,
    });
    expect(cost).toBeCloseTo(0.00125, 6);
  });

  it("sums all four token types correctly", () => {
    // Haiku: 5,000 input + 500 output + 2,000 cache-read + 1,000 cache-write
    // = 5000/1M × $1     = $0.005
    // + 500/1M × $5     = $0.0025
    // + 2000/1M × $0.10 = $0.0002
    // + 1000/1M × $1.25 = $0.00125
    // = $0.00895
    const cost = estimateCostUsd({
      modelId: "claude-haiku-4-5",
      inputTokens: 5_000,
      outputTokens: 500,
      cacheReadInputTokens: 2_000,
      cacheCreationInputTokens: 1_000,
    });
    expect(cost).toBeCloseTo(0.00895, 5);
  });

  it("uses fallback rates for unknown model ids", () => {
    // Sonnet fallback: 1,000 input × $3/MTok = $0.003
    const cost = estimateCostUsd({
      modelId: "claude-future-5-0",
      inputTokens: 1_000,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    });
    expect(cost).toBeCloseTo(0.003, 6);
  });

  it("handles null model id with fallback rates", () => {
    const cost = estimateCostUsd({
      modelId: null,
      inputTokens: 1_000,
      outputTokens: 100,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    });
    // Sonnet: 1000/1M × $3 + 100/1M × $15 = $0.003 + $0.0015 = $0.0045
    expect(cost).toBeCloseTo(0.0045, 6);
  });

  it("rounds to 6 decimals to match the numeric(10, 6) column", () => {
    const cost = estimateCostUsd({
      modelId: "claude-haiku-4-5",
      inputTokens: 1,
      outputTokens: 1,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    });
    // Theoretical: 1/1M + 5/1M = 6/1M = 0.000006
    expect(cost).toBe(0.000006);
  });
});
