/**
 * Tests for the essay-scaffold generator.
 *
 * Pure-logic tests against the templating function. The page's
 * server-side composition is exercised via the live build / E2E in
 * later sessions.
 */

import { describe, expect, it } from "vitest";
import {
  buildEssayScaffold,
  type EssayScaffoldInput,
} from "./admin-essay-scaffold";

const FIXED_NOW = new Date("2026-04-25T12:00:00Z");

const MEASURED_INPUT: EssayScaffoldInput = {
  measured_system: {
    state: "measured",
    value: 0.872,
    ci_low: 0.851,
    ci_high: 0.893,
    sample_size: 1234,
  },
  measured_self_drift: {
    state: "measured",
    value: 0.91,
    ci_low: 0.886,
    ci_high: 0.934,
    sample_size: 200,
  },
  design_target: 0.9,
  recent_calibration_filename: "2026-17.md",
  recent_calibration_modified_at: "2026-04-21T14:00:00Z",
  override_count_30d: 47,
  active_refinements: [
    {
      id: "REF-001",
      title: "ui_label → ui_label + section_header",
      status: "open",
      raw: "",
    },
    {
      id: "REF-002",
      title: "ui_label split for data viz",
      status: "open",
      raw: "",
    },
    {
      id: "REF-003",
      title: "another candidate",
      status: "open",
      raw: "",
    },
    {
      id: "REF-004",
      title: "fourth — should not appear",
      status: "open",
      raw: "",
    },
  ],
};

describe("buildEssayScaffold", () => {
  it("titles the scaffold with the ISO week number", () => {
    const out = buildEssayScaffold(MEASURED_INPUT, FIXED_NOW);
    expect(out.title).toMatch(/Calibration log, week 2026-\d{2}/);
  });

  it("includes the measured system kappa with CI", () => {
    const out = buildEssayScaffold(MEASURED_INPUT, FIXED_NOW);
    expect(out.body).toContain("κ is 0.872");
    expect(out.body).toContain("[0.851, 0.893]");
  });

  it("includes the design target stated separately", () => {
    const out = buildEssayScaffold(MEASURED_INPUT, FIXED_NOW);
    expect(out.body).toContain("design target");
    expect(out.body).toContain("0.90");
  });

  it("includes self-drift kappa when measured", () => {
    const out = buildEssayScaffold(MEASURED_INPUT, FIXED_NOW);
    expect(out.body).toContain("Self-drift κ");
    expect(out.body).toContain("0.910");
  });

  it("surfaces a pending self-drift sentinel honestly", () => {
    const out = buildEssayScaffold(
      {
        ...MEASURED_INPUT,
        measured_self_drift: {
          state: "pending_measurement",
          reason: "panel awaiting blind re-label",
        },
      },
      FIXED_NOW,
    );
    expect(out.body).toContain("pending");
    expect(out.body).toContain("panel awaiting blind re-label");
    expect(out.body).not.toContain("0.000");
  });

  it("references the override count with proper pluralisation", () => {
    const out = buildEssayScaffold(MEASURED_INPUT, FIXED_NOW);
    expect(out.body).toContain("47 overrides logged");
  });

  it("uses singular for an override count of one", () => {
    const out = buildEssayScaffold(
      { ...MEASURED_INPUT, override_count_30d: 1 },
      FIXED_NOW,
    );
    expect(out.body).toContain("1 override logged");
  });

  it("lists up to three active refinements", () => {
    const out = buildEssayScaffold(MEASURED_INPUT, FIXED_NOW);
    expect(out.body).toContain("REF-001");
    expect(out.body).toContain("REF-002");
    expect(out.body).toContain("REF-003");
    // The fourth is omitted — scaffolds stay focused.
    expect(out.body).not.toContain("REF-004");
  });

  it("offers an alt path when there are no open refinements", () => {
    const out = buildEssayScaffold(
      { ...MEASURED_INPUT, active_refinements: [] },
      FIXED_NOW,
    );
    expect(out.body).toContain("No open refinement candidates");
  });

  it("anchors against the recent calibration file when available", () => {
    const out = buildEssayScaffold(MEASURED_INPUT, FIXED_NOW);
    expect(out.body).toContain("reports/calibration/2026-17.md");
  });

  it("falls back to a Phase C nudge when no calibration log exists yet", () => {
    const out = buildEssayScaffold(
      {
        ...MEASURED_INPUT,
        recent_calibration_filename: null,
        recent_calibration_modified_at: null,
      },
      FIXED_NOW,
    );
    expect(out.body).toContain("Phase C ships the generator");
  });

  it("counts words and reports a generated_at ISO timestamp", () => {
    const out = buildEssayScaffold(MEASURED_INPUT, FIXED_NOW);
    expect(out.word_count).toBeGreaterThan(80);
    expect(out.word_count).toBeLessThan(400);
    expect(out.generated_at).toBe(FIXED_NOW.toISOString());
  });
});
