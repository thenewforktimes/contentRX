/**
 * Taxonomy constants mirrored from the Python engine.
 *
 * The Python engine (python/content_checker/) embeds these in the LLM
 * system prompt. If a caller supplies a value outside these sets, the
 * engine will template arbitrary text into the prompt — a clean
 * prompt-injection vector. Zod-validate against these lists at every
 * public entry point.
 *
 * Source:
 *   content types → python/content_checker/standards/standards_library.json
 *   moments        → python/content_checker/moments.py :: MOMENT_TAXONOMY
 *
 * Sync: if the Python side gains or renames an entry, update this file.
 * A lightweight CI check could assert these match; not wired in yet.
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

export const AUDIENCES = ["product_ui", "general"] as const;
export type Audience = (typeof AUDIENCES)[number];
