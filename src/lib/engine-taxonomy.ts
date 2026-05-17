/**
 * Taxonomy constants mirrored from the Python engine.
 *
 * The Python engine (src/content_checker/) embeds these in the LLM
 * system prompt. If a caller supplies a value outside these sets, the
 * engine will template arbitrary text into the prompt — a clean
 * prompt-injection vector. Zod-validate against these lists at every
 * public entry point.
 *
 * Source of truth:
 *   content types → src/content_checker/standards/private/standards_library.json :: content_types
 *   moments       → src/content_checker/moments.py :: MOMENT_TAXONOMY
 *   audiences     → src/content_checker/audience.py :: Audience enum
 *
 * Drift between this file and the Python sources is caught by
 * `tests/test_engine_taxonomy_ts_mirror.py` (wired into
 * `.github/workflows/parity.yml` as a parity gate).
 */

export const CONTENT_TYPES = [
  "button_cta",
  "error_message",
  "confirmation",
  "tooltip_microcopy",
  "ui_label",
  "short_ui_copy",
  "long_form_copy",
  "heading",
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

export const MOMENTS = [
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
] as const;

export type Moment = (typeof MOMENTS)[number];

export const AUDIENCES = ["product_ui", "general", "native_mobile"] as const;
export type Audience = (typeof AUDIENCES)[number];
