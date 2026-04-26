/**
 * Moment taxonomy metadata — TypeScript mirror of
 * `src/content_checker/moments.py` :: MOMENT_TAXONOMY.
 *
 * Human-eval build plan Session 22. Used by the "Moment detected"
 * banner on every verdict-presenting surface:
 *
 *   - Labels + descriptions for the correction dropdown.
 *   - Situation-property tags for destructive / permission-gated /
 *     compliance moments.
 *   - Per-moment weight-count summary (how many standards the moment
 *     emphasizes, relaxes, or suppresses).
 *
 * The hand-mirrored descriptions in this file are pinned to the Python
 * source by a Python-side test: `tests/test_moment_metadata_ts_mirror.py`
 * parses MOMENT_DESCRIPTIONS with a narrow regex and asserts it matches
 * `MOMENT_TAXONOMY`. Drift fails CI rather than silently skewing the
 * UI text.
 *
 * Client-safe: this module is import-able from client components
 * (no `fs`, no Node built-ins). The server-only helpers that parse
 * `moments_taxonomy.json` live in `moment-metadata.server.ts`.
 */

import { type Moment } from "./engine-taxonomy";

/**
 * Hand-mirrored — keep in sync with MOMENT_TAXONOMY in moments.py.
 * `tests/test_moment_metadata_ts_mirror.py` pins the contract.
 */
export const MOMENT_DESCRIPTIONS: Record<Moment, string> = {
  first_encounter:
    "Onboarding, setup, first-run. Clarity above all.",
  browsing_discovery:
    "Homepages, landing pages, feature tours. Scannability matters.",
  decision_point:
    "Pricing, plan selection, upgrade prompts. No dark patterns.",
  task_execution:
    "Form filling, configuration, multi-step flows. Actionable labels.",
  confirmation:
    "Success, saved, completed. Brevity, passive voice is fine.",
  celebration:
    "Achievement, milestone, streak. Enthusiasm is earned, not excessive.",
  error_recovery:
    "Validation, system errors, failed states. No blame, clear next step.",
  destructive_action:
    "Delete, cancel, irreversible. Explicit consequences, friction OK.",
  empty_state:
    "Zero data, no results. Helpful, suggest next action.",
  interruption:
    "Modals, toasts, notifications. Brevity critical, clear dismiss.",
  trust_permission:
    "Consent, verification, permissions. Precision over warmth, hedging OK.",
  wayfinding:
    "Navigation, breadcrumbs, section labels. Consistency, space-constrained OK.",
  compliance_disclosure:
    "Regulatory disclaimers, legal mandates, FDIC notices. Mandated language takes precedence.",
};

/**
 * Human-readable labels for the `situation_property` attribute of
 * destructive / permission-gated / compliance moments. Hand-mirror of
 * `SITUATION_PROPERTY_BY_MOMENT` in
 * `src/content_checker/moments.py` (the engine-side canonical source).
 * `tests/test_moment_metadata_ts_mirror.py` pins this against the
 * Python definition so any drift fails CI.
 */
export const SITUATION_PROPERTY_BY_MOMENT: Partial<Record<Moment, string>> = {
  destructive_action: "destructive",
  trust_permission: "permission-gated",
  compliance_disclosure: "compliance",
};

export interface MomentWeightsSummary {
  /** Total weighted standards across all three modifier types. */
  total: number;
  emphasized: number;
  relaxed: number;
  suppressed: number;
}

/**
 * Pure helper — shapes the banner's lead sentence from a moment ID.
 *   summarizeMomentBanner("destructive_action", { emphasized: 3, ... })
 *   → "Looks like destructive_action — 3 standards emphasized, 0 relaxed."
 *
 * Returns null when the moment has no weighted standards — no point
 * in showing a banner that says "I'm applying zero special adjustments."
 */
export function summarizeMomentBanner(
  momentId: string,
  summary: MomentWeightsSummary | null,
): string | null {
  if (!summary) return null;
  const { emphasized, relaxed, suppressed, total } = summary;
  if (total === 0) return null;
  const parts: string[] = [];
  if (emphasized > 0) parts.push(`${emphasized} emphasized`);
  if (relaxed > 0) parts.push(`${relaxed} relaxed`);
  if (suppressed > 0) parts.push(`${suppressed} suppressed`);
  return `Looks like ${momentId} — ${parts.join(", ")}.`;
}
