import { describe, expect, it } from "vitest";
import {
  humanizeReviewReason,
  humanizeSeverity,
  humanizeVerdict,
} from "./humanize";

/**
 * Tests pin the customer-facing vocabulary locked by ADR 2026-04-29.
 * If a future edit reverts to "Violation" or removes a tier from the
 * severity ladder, these tests catch the regression before it reaches
 * a customer surface.
 */

describe("humanizeVerdict", () => {
  it("renders pass as 'All clear' in emerald", () => {
    const out = humanizeVerdict("pass", 0);
    expect(out).toEqual({ label: "All clear", tone: "emerald" });
  });

  it("renders review_recommended as 'Worth a look' in amber", () => {
    const out = humanizeVerdict("review_recommended", 0);
    expect(out).toEqual({ label: "Worth a look", tone: "amber" });
  });

  it("renders single-finding violation as '1 finding to adjust' (no plural-s)", () => {
    const out = humanizeVerdict("violation", 1);
    expect(out).toEqual({ label: "1 finding to adjust", tone: "amber" });
  });

  it("renders multi-finding violation as 'N findings to adjust' (explicit plural)", () => {
    const out = humanizeVerdict("violation", 3);
    expect(out).toEqual({ label: "3 findings to adjust", tone: "amber" });
  });

  it("renders ship-blocker violation as 'Adjust before shipping' in red", () => {
    const out = humanizeVerdict("violation", 1, true);
    expect(out).toEqual({ label: "Adjust before shipping", tone: "red" });
  });

  it("never emits the word 'Violation' on the customer surface", () => {
    // Per docs/copy-vocabulary.md: "Violations stays in API + DB.
    // Findings is what customers see." The humanizer is the rendering
    // boundary that enforces this.
    const samples = [
      humanizeVerdict("pass", 0),
      humanizeVerdict("review_recommended", 0),
      humanizeVerdict("violation", 1),
      humanizeVerdict("violation", 5),
      humanizeVerdict("violation", 1, true),
    ];
    for (const sample of samples) {
      expect(sample.label).not.toMatch(/Violation/i);
    }
  });

  it("falls back gracefully on unknown verdict keyword", () => {
    const out = humanizeVerdict("some_new_verdict", 0);
    // Defensive fallback: sentence-cased, no crash. Tone defaults to
    // amber so the unknown state is visible without screaming red.
    expect(out.label).toBe("Some new verdict");
    expect(out.tone).toBe("amber");
  });
});

describe("humanizeSeverity", () => {
  it("renders high as 'Consider' in amber", () => {
    const out = humanizeSeverity("high");
    expect(out).toEqual({ label: "Consider", tone: "amber" });
  });

  it("renders medium as 'Consider' in amber (same label as high)", () => {
    const out = humanizeSeverity("medium");
    expect(out).toEqual({ label: "Consider", tone: "amber" });
  });

  it("renders low as 'Consider' in stone (same label, lower visual weight)", () => {
    const out = humanizeSeverity("low");
    expect(out).toEqual({ label: "Consider", tone: "stone" });
  });

  it("renders ship-blocker high as 'Don't ship' in red", () => {
    const out = humanizeSeverity("high", true);
    expect(out).toEqual({ label: "Don't ship", tone: "red" });
  });

  it("ship-blocker flag does not promote medium or low", () => {
    // Only high + isShipBlocker triggers Don't ship. Lower severities
    // stay on their default paths even with the flag, so a misuse of
    // the flag at a call site doesn't escalate a low-severity finding.
    expect(humanizeSeverity("medium", true)).toEqual({
      label: "Consider",
      tone: "amber",
    });
    expect(humanizeSeverity("low", true)).toEqual({
      label: "Consider",
      tone: "stone",
    });
  });

  it("never emits raw substrate words like 'High' / 'Medium' / 'Low'", () => {
    // The substrate enums are render-internal. The customer label
    // ladder is locked by the ADR; raw enum case-flips like "High"
    // would be a regression to the pre-ADR pattern.
    for (const sev of ["high", "medium", "low"]) {
      const out = humanizeSeverity(sev);
      expect(out.label).not.toMatch(/^High$/);
      expect(out.label).not.toMatch(/^Medium$/);
      expect(out.label).not.toMatch(/^Low$/);
    }
  });

  it("falls back gracefully on unknown severity keyword", () => {
    const out = humanizeSeverity("catastrophic");
    expect(out.label).toBe("Catastrophic");
    expect(out.tone).toBe("stone");
  });
});

describe("severity → tone color discipline", () => {
  it("reserves red for ship-blockers only", () => {
    // ADR 2026-04-29 §9d locks the color rule. Red is rare and earned.
    // Default high/medium severity must NEVER emit red.
    expect(humanizeSeverity("high").tone).not.toBe("red");
    expect(humanizeSeverity("medium").tone).not.toBe("red");
    expect(humanizeSeverity("low").tone).not.toBe("red");
    // Only high + ship-blocker promotes to red.
    expect(humanizeSeverity("high", true).tone).toBe("red");
  });

  it("verdict tone reserves red for hasShipBlocker only", () => {
    // pass / review / violation default paths never emit red. Only
    // the explicit ship-blocker conditional does.
    expect(humanizeVerdict("pass", 0).tone).not.toBe("red");
    expect(humanizeVerdict("review_recommended", 0).tone).not.toBe("red");
    expect(humanizeVerdict("violation", 1).tone).not.toBe("red");
    expect(humanizeVerdict("violation", 100).tone).not.toBe("red");
    // Only ship-blocker promotes to red.
    expect(humanizeVerdict("violation", 1, true).tone).toBe("red");
  });
});

describe("humanizeReviewReason", () => {
  it("returns empty string for null / undefined", () => {
    expect(humanizeReviewReason(null)).toBe("");
    expect(humanizeReviewReason(undefined)).toBe("");
    expect(humanizeReviewReason("")).toBe("");
  });

  it("renders each known subtype as customer-action-shaped copy", () => {
    // The previous vocabulary leaked engine-stage names ("first-pass",
    // "validation", "review threshold"). The new copy answers "what
    // should the customer do?" — these tests pin the rewrite.
    expect(humanizeReviewReason("low_confidence")).toBe(
      "We weren't fully sure about this one",
    );
    expect(humanizeReviewReason("standards_conflict")).toBe(
      "Two rules pointed different directions",
    );
    expect(humanizeReviewReason("ensemble_disagreement")).toBe(
      "Worth a closer look. We're not certain",
    );
    expect(humanizeReviewReason("situation_ambiguity")).toBe(
      "Hard to tell what kind of copy this is",
    );
    expect(humanizeReviewReason("out_of_distribution")).toBe(
      "Unfamiliar shape. Your eyes will help",
    );
    expect(humanizeReviewReason("novel_pattern")).toBe(
      "This rule is shifting. Double-check",
    );
    expect(humanizeReviewReason("low_confidence_mixed_signals")).toBe(
      "Mixed signals. Worth a second pass",
    );
    expect(humanizeReviewReason("high_confidence_mixed_signals")).toBe(
      "Confident, but signals are mixed",
    );
  });

  it("never emits engine-pipeline jargon", () => {
    // Regression guard. The earlier vocabulary said "first-pass and
    // validation disagreed", "confidence below the review threshold",
    // "override rate climbing". Those are pipeline / metric terms;
    // customer copy should never include them.
    const samples = [
      humanizeReviewReason("low_confidence"),
      humanizeReviewReason("standards_conflict"),
      humanizeReviewReason("ensemble_disagreement"),
      humanizeReviewReason("situation_ambiguity"),
      humanizeReviewReason("out_of_distribution"),
      humanizeReviewReason("novel_pattern"),
      humanizeReviewReason("low_confidence_mixed_signals"),
      humanizeReviewReason("high_confidence_mixed_signals"),
    ];
    for (const sample of samples) {
      expect(sample.toLowerCase()).not.toMatch(/first-?pass/);
      expect(sample.toLowerCase()).not.toMatch(/validation/);
      expect(sample.toLowerCase()).not.toMatch(/preprocessor/);
      expect(sample.toLowerCase()).not.toMatch(/review threshold/);
      expect(sample.toLowerCase()).not.toMatch(/override rate/);
      expect(sample.toLowerCase()).not.toMatch(/ensemble/);
      // No em dashes (suggestion-quality brand voice rule)
      expect(sample).not.toMatch(/—/);
    }
  });

  it("falls back gracefully on unknown subtype", () => {
    // Defensive: a new subtype we haven't mapped yet shouldn't crash.
    // Sentence-cases the raw string so the gap is visible.
    expect(humanizeReviewReason("some_new_subtype")).toBe("Some new subtype");
  });
});
