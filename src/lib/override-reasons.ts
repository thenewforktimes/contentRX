/**
 * Override-reason vocabulary — human-eval build plan Session 4.
 *
 * User-facing reason codes. Distinct from Robert's `triage_category`
 * vocabulary (from EVAL_PROTOCOL: correct, misclassification,
 * hallucination, missing_standard, context_gap). The two feed
 * different loops:
 *
 *   - User reason codes → UX, weighting, which items escalate to
 *     Robert's queue.
 *   - Robert's triage_category → architectural responses (classifier
 *     work, standards library gap, audience/moment gating).
 *
 * During review, Robert reconciles the two on a case-by-case basis. The
 * mapping below captures the *typical* correspondence — it's not a
 * mechanical translation. "not_applicable_here" frequently becomes
 * `context_gap` after review, but sometimes it becomes
 * `misclassification` when the situation detector was actually right
 * and the user misread the flagged string.
 */

export type OverrideReasonCode =
  | "not_applicable_here"
  | "standard_too_strict"
  | "fix_is_worse"
  | "shipping_anyway"
  | "confusing_need_more_context";

export const OVERRIDE_REASON_CODES: readonly OverrideReasonCode[] = [
  "not_applicable_here",
  "standard_too_strict",
  "fix_is_worse",
  "shipping_anyway",
  "confusing_need_more_context",
] as const;

export interface OverrideReasonMeta {
  code: OverrideReasonCode;
  /** Short label shown in UI dropdowns. */
  label: string;
  /** Longer tooltip / aria-description explaining when to pick this. */
  description: string;
  /** The triage_category this reason *typically* becomes after review. */
  typicalTriageCategory:
    | "context_gap"
    | "misclassification"
    | "hallucination"
    | "missing_standard"
    | "correct";
}

export const OVERRIDE_REASON_META: Record<
  OverrideReasonCode,
  OverrideReasonMeta
> = {
  not_applicable_here: {
    code: "not_applicable_here",
    label: "Not applicable here",
    description:
      "The situation detector picked the wrong context for my content.",
    // Typically a context_gap — the moment/content_type routing
    // needs a refinement-log entry. Occasionally a
    // misclassification if the situation was correct and the user
    // misread.
    typicalTriageCategory: "context_gap",
  },
  standard_too_strict: {
    code: "standard_too_strict",
    label: "Too strict for this case",
    description: "The judgment feels wrong in context.",
    // Typically a missing_standard — the rule needs a content_type_notes
    // carve-out or the standard's examples need updating.
    typicalTriageCategory: "missing_standard",
  },
  fix_is_worse: {
    code: "fix_is_worse",
    label: "Suggested fix is worse",
    description: "The counterfactual is wrong even if the diagnosis is right.",
    // Typically a misclassification at the suggestion stage. Occasionally
    // correct when the user's alternative is objectively worse but they
    // prefer it for brand reasons.
    typicalTriageCategory: "misclassification",
  },
  shipping_anyway: {
    code: "shipping_anyway",
    label: "I agree — shipping anyway",
    description: "Deadline-driven accept-but-override.",
    // Typically `correct` at the pipeline level (the tool's finding
    // was right and the user agrees); the override itself is a
    // ship-anyway stance, not an architectural signal.
    typicalTriageCategory: "correct",
  },
  confusing_need_more_context: {
    code: "confusing_need_more_context",
    label: "Confusing, need more context",
    description: "The rationale didn't help me decide.",
    // Typically a missing_standard at the rationale/examples level
    // — the rule exists but its content_type_notes or example pairs
    // aren't helping the user understand.
    typicalTriageCategory: "missing_standard",
  },
};

/**
 * Convenience helper — returns the UI dropdown options in canonical
 * order. Used by every surface that shows the reason picker.
 */
export function overrideReasonOptions(): readonly OverrideReasonMeta[] {
  return OVERRIDE_REASON_CODES.map((c) => OVERRIDE_REASON_META[c]);
}

/**
 * The triage_category this reason code would *typically* map to on
 * Robert's review. Not a promise — reconciliation is a judgment call.
 */
export function typicalTriageCategory(
  code: OverrideReasonCode,
): OverrideReasonMeta["typicalTriageCategory"] {
  return OVERRIDE_REASON_META[code].typicalTriageCategory;
}
