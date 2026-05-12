import { describe, it, expect } from "vitest";
import { AUDIENCES, CONTENT_TYPES, MOMENTS } from "./engine-taxonomy";

/**
 * These constants are injected into the LLM system prompt via
 * `api/evaluate.py`. Any value the web app accepts that isn't in
 * these lists becomes an arbitrary string templated into the prompt
 * — a clean prompt-injection vector.
 *
 * This test pins the current set. When the Python engine adds a
 * legitimate new value, this test should fail and the developer
 * should update both sides explicitly. That's the whole point —
 * we'd rather fail a test than silently drift.
 */
describe("engine-taxonomy", () => {
  it("CONTENT_TYPES matches the Python engine's authoritative list", () => {
    expect([...CONTENT_TYPES].sort()).toEqual(
      [
        "button_cta",
        "confirmation",
        "error_message",
        "heading",
        "long_form_copy",
        "short_ui_copy",
        "tooltip_microcopy",
        "ui_label",
      ].sort(),
    );
  });

  it("MOMENTS matches the Python engine's 13-entry taxonomy", () => {
    expect(MOMENTS.length).toBe(13);
    expect([...MOMENTS]).toEqual(
      expect.arrayContaining([
        "first_encounter",
        "browsing_discovery",
        "decision_point",
        "task_execution",
        "confirmation",
        "celebration",
        "error_recovery",
        "destructive_action",
        "empty_state",
        "interruption",
        "trust_permission",
        "wayfinding",
        "compliance_disclosure",
      ]),
    );
  });

  it("AUDIENCES is the expected 3-entry set", () => {
    // `native_mobile` landed in PR #338 (Python `Audience` enum)
    // with dedicated engine logic (ACC-08 passes unconditionally
    // when audience=native_mobile). The TS list was missing it
    // through the entire beta-prep window — caught + fixed in the
    // 2026-05-11 audit follow-up alongside the new
    // tests/test_engine_taxonomy_ts_mirror.py parity gate.
    expect([...AUDIENCES].sort()).toEqual([
      "general",
      "native_mobile",
      "product_ui",
    ]);
  });
});
