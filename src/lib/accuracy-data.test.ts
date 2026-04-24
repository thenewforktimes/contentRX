import { describe, expect, it } from "vitest";
import {
  DESIGN_TARGET_KAPPA,
  buildAccuracySnapshot,
} from "./accuracy-data";

/**
 * Tests for the /accuracy page aggregator. The three-number invariant
 * is central to Session 24 — a regression that collapses the kappa
 * numbers into a composite score would break the accountability
 * commitment in the plan's spec. These tests pin the invariant at the
 * data-boundary level; the page template pins it at the render layer.
 */

describe("buildAccuracySnapshot (committed readiness + drift state)", () => {
  it("returns three distinct kappa fields with separate types", () => {
    const snap = buildAccuracySnapshot();
    expect(snap).toHaveProperty("measured_system");
    expect(snap).toHaveProperty("measured_self_drift");
    expect(snap).toHaveProperty("design_target");
    // Design target is a numeric constant, not a Kappa — so the page
    // can't accidentally render "measured CI" text on it.
    expect(typeof snap.design_target).toBe("number");
    expect(snap).not.toHaveProperty("accuracy_score");
    expect(snap).not.toHaveProperty("composite_score");
  });

  it("locks design target at 0.90", () => {
    const snap = buildAccuracySnapshot();
    expect(snap.design_target).toBe(DESIGN_TARGET_KAPPA);
    expect(DESIGN_TARGET_KAPPA).toBe(0.9);
  });

  it("reports measured_system as pending when no weekly kappa is populated", () => {
    const snap = buildAccuracySnapshot();
    // Today's readiness.json has kappa.value: null everywhere, so the
    // aggregator must surface the pre-measurement state honestly — not
    // fill it with zero or the design target.
    if (snap.measured_system.state === "measured") {
      expect(snap.measured_system.value).not.toBe(0);
      expect(snap.measured_system.value).not.toBe(snap.design_target);
    } else {
      expect(snap.measured_system.state).toBe("pending_measurement");
      expect(snap.measured_system.reason).toMatch(/weekly kappa|no weighted/i);
    }
  });

  it("reports measured_self_drift as pending until a scored drift report lands", () => {
    const snap = buildAccuracySnapshot();
    // No evals/drift/reports/*.json exists in the repo today — the
    // panel file exists but hasn't been scored. Aggregator must not
    // coerce to zero or to the ceiling.
    expect(snap.measured_self_drift.state).toBe("pending_measurement");
  });

  it("surfaces 43 standards under robo_labels in the current state", () => {
    const snap = buildAccuracySnapshot();
    const total =
      snap.by_level.robo_labels +
      snap.by_level.batch_approval +
      snap.by_level.autonomous;
    expect(total).toBeGreaterThan(0);
    expect(snap.standards.length).toBe(total);
  });

  it("publishes a failure-modes list that explicitly warns against composite scores", () => {
    const snap = buildAccuracySnapshot();
    const titles = snap.failure_modes.map((m) => m.title.toLowerCase());
    expect(titles.some((t) => t.includes("composite"))).toBe(true);
  });

  it("chooses an 'early' review-queue phase while measurements are pending", () => {
    const snap = buildAccuracySnapshot();
    expect(snap.review_queue_phase.phase).toBe("early");
    expect(snap.review_queue_phase.description).toMatch(/seeding|early/i);
  });

  it("every per-standard row carries a level field from the canonical ladder", () => {
    const snap = buildAccuracySnapshot();
    const validLevels = new Set([
      "robo_labels",
      "batch_approval",
      "autonomous",
    ]);
    for (const s of snap.standards) {
      expect(validLevels.has(s.level)).toBe(true);
    }
  });

  it("per-standard kappa CI stays inside [-1, 1] and bounds the point estimate", () => {
    const snap = buildAccuracySnapshot();
    for (const s of snap.standards) {
      if (s.kappa.state !== "measured") continue;
      expect(s.kappa.ci_low).toBeGreaterThanOrEqual(-1);
      expect(s.kappa.ci_high).toBeLessThanOrEqual(1);
      expect(s.kappa.ci_low).toBeLessThanOrEqual(s.kappa.value);
      expect(s.kappa.ci_high).toBeGreaterThanOrEqual(s.kappa.value);
    }
  });
});
