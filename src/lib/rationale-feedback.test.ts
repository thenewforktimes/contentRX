import { describe, expect, it } from "vitest";
import {
  RATIONALE_CORRECTION_TYPES,
  RATIONALE_HOPS,
  RATIONALE_SOURCES,
  RationaleFeedbackRequestSchema,
} from "./rationale-feedback";

/**
 * Pins the public contract of /api/feedback/rationale. The Figma
 * plugin, CLI, and web-app dashboard all post to this endpoint — the
 * schema is the boundary. Divergence here is a client-breaking change.
 *
 * Human-eval build plan Session 21.
 */

const validHash = "a".repeat(64);

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    text_hash: validHash,
    hop_step: "detect_moment" as const,
    correction_type: "situation_ambiguity" as const,
    original_value: "decision_point",
    source: "plugin" as const,
    ...overrides,
  };
}

describe("RationaleFeedbackRequestSchema", () => {
  it("accepts a minimal valid body", () => {
    const parsed = RationaleFeedbackRequestSchema.safeParse(validBody());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.hop_step).toBe("detect_moment");
      expect(parsed.data.correction_type).toBe("situation_ambiguity");
      expect(parsed.data.source).toBe("plugin");
    }
  });

  it("defaults source to dashboard when omitted", () => {
    const parsed = RationaleFeedbackRequestSchema.safeParse({
      text_hash: validHash,
      hop_step: "detect_moment",
      correction_type: "situation_ambiguity",
      original_value: "decision_point",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.source).toBe("dashboard");
  });

  it("rejects an unhashed text field (missed the SHA-256 step)", () => {
    const parsed = RationaleFeedbackRequestSchema.safeParse(
      validBody({ text_hash: "this is plaintext not a hash" }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects an invalid hop_step", () => {
    const parsed = RationaleFeedbackRequestSchema.safeParse(
      validBody({ hop_step: "invented_step" }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects an invalid correction_type", () => {
    const parsed = RationaleFeedbackRequestSchema.safeParse(
      validBody({ correction_type: "I_DISAGREE" }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects an empty original_value", () => {
    const parsed = RationaleFeedbackRequestSchema.safeParse(
      validBody({ original_value: "" }),
    );
    expect(parsed.success).toBe(false);
  });

  it("bounds note at 500 chars", () => {
    const ok = RationaleFeedbackRequestSchema.safeParse(
      validBody({ note: "x".repeat(500) }),
    );
    const bad = RationaleFeedbackRequestSchema.safeParse(
      validBody({ note: "x".repeat(501) }),
    );
    expect(ok.success).toBe(true);
    expect(bad.success).toBe(false);
  });

  it("accepts every documented source value", () => {
    for (const src of RATIONALE_SOURCES) {
      const parsed = RationaleFeedbackRequestSchema.safeParse(
        validBody({ source: src }),
      );
      expect(parsed.success, `source: ${src}`).toBe(true);
    }
  });

  it("accepts every documented hop_step value", () => {
    for (const hop of RATIONALE_HOPS) {
      const parsed = RationaleFeedbackRequestSchema.safeParse(
        validBody({ hop_step: hop }),
      );
      expect(parsed.success, `hop: ${hop}`).toBe(true);
    }
  });

  it("enumerates exactly two correction types (situation_ambiguity + other)", () => {
    expect([...RATIONALE_CORRECTION_TYPES].sort()).toEqual([
      "other",
      "situation_ambiguity",
    ]);
  });
});
