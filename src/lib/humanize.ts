/**
 * Human-readable labels for the engine's snake_case enum values.
 *
 * The engine's wire format uses snake_case for moments, content types,
 * and review-reason subtypes (`error_state`, `ui_label`,
 * `low_confidence_mixed_signals`, etc.). Rendering those raw to a
 * human is jarring — "low confidence mixed signals" is technically
 * the result of `replace(/_/g, " ")` but it reads as machine output.
 *
 * Use the helpers here at the rendering boundary to produce
 * sentence-cased text. The known-value tables below are the
 * authoritative customer-facing labels; unknown values fall back to
 * a defensive title-cased rewrite of the enum string so we never
 * crash on a new enum, but flag the gap by keeping it slightly
 * off-tone.
 */

const MOMENT_LABELS: Record<string, string> = {
  error_state: "Error state",
  empty_state: "Empty state",
  destructive_confirmation: "Destructive confirmation",
  permissions_request: "Permissions request",
  onboarding: "Onboarding",
  first_encounter: "First encounter",
  loading: "Loading state",
  success: "Success message",
  warning: "Warning",
  notification: "Notification",
  compliance_disclosure: "Compliance disclosure",
  navigation: "Navigation",
  marketing: "Marketing",
};

const CONTENT_TYPE_LABELS: Record<string, string> = {
  ui_label: "UI label",
  button: "Button",
  link: "Link",
  heading: "Heading",
  body_paragraph: "Body paragraph",
  toast: "Toast",
  tooltip: "Tooltip",
  form_label: "Form label",
  placeholder: "Placeholder",
  alt_text: "Alt text",
  empty_state_text: "Empty state",
  error_message: "Error message",
  section_header: "Section header",
};

const REVIEW_REASON_LABELS: Record<string, string> = {
  low_confidence: "Confidence below the review threshold",
  standards_conflict: "Two rules disagreed on this string",
  ensemble_disagreement: "First-pass and validation disagreed",
  situation_ambiguity: "Couldn't pin down the moment",
  out_of_distribution: "New kind of input",
  novel_pattern: "Override rate climbing on this rule",
  low_confidence_mixed_signals: "Mixed signals — low confidence",
  high_confidence_mixed_signals: "Mixed signals despite high confidence",
};

const OVERRIDE_STANCE_LABELS: Record<string, string> = {
  agree: "Agreed",
  disagree: "Disagreed",
  ship_anyway: "Shipped anyway",
  informed_reject: "Informed reject",
  informed_accept: "Informed accept",
  pattern_match_accept: "Pattern-match accept",
  reflex_reject: "Reflex reject",
};

function fallback(raw: string): string {
  // Defensive fallback for enums we haven't mapped yet — avoid raw
  // snake_case in the UI but signal the gap with sentence case.
  const spaced = raw.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function humanizeMoment(value: string | null | undefined): string {
  if (!value) return "";
  return MOMENT_LABELS[value] ?? fallback(value);
}

export function humanizeContentType(value: string | null | undefined): string {
  if (!value) return "";
  return CONTENT_TYPE_LABELS[value] ?? fallback(value);
}

export function humanizeReviewReason(value: string | null | undefined): string {
  if (!value) return "";
  return REVIEW_REASON_LABELS[value] ?? fallback(value);
}

export function humanizeOverrideStance(value: string | null | undefined): string {
  if (!value) return "";
  return OVERRIDE_STANCE_LABELS[value] ?? fallback(value);
}

/**
 * The customer-facing pill tone vocabulary. Mirrors PillTone in
 * src/components/ui/pill.tsx but kept narrow here since these
 * helpers only emit a subset.
 */
export type CustomerToneVerdict = "emerald" | "amber" | "red";
export type CustomerToneSeverity = "amber" | "red" | "stone";

/**
 * Humanize a substrate verdict into a customer-facing label + tone.
 *
 * The substrate enums (`pass` / `review_recommended` / `violation`)
 * are render-internal; customers see warmer, more productive labels.
 * See ADR 2026-04-29 §9a for the locked vocabulary and the rationale
 * behind dropping "Violation" from customer-visible copy
 * (docs/copy-vocabulary.md: "Violations stays in API + DB. Findings
 * is what customers see.").
 *
 * The "Adjust before shipping" + red-tone path requires a hard-rule
 * signal that today's schema 2.0 envelope doesn't carry. When the
 * envelope adds that signal in a future bump, pass `hasShipBlocker:
 * true` to surface it. For now the default amber path covers every
 * `verdict: violation` regardless of finding kind.
 */
export function humanizeVerdict(
  verdict: string,
  findingCount: number,
  hasShipBlocker = false,
): { label: string; tone: CustomerToneVerdict } {
  if (verdict === "pass") {
    return { label: "All clear", tone: "emerald" };
  }
  if (verdict === "review_recommended") {
    return { label: "Worth a look", tone: "amber" };
  }
  if (verdict === "violation") {
    if (hasShipBlocker) {
      return { label: "Adjust before shipping", tone: "red" };
    }
    if (findingCount === 1) {
      return { label: "1 finding to adjust", tone: "amber" };
    }
    return { label: `${findingCount} findings to adjust`, tone: "amber" };
  }
  // Defensive fallback: unknown verdict keyword. Render the raw
  // value sentence-cased so the gap is visible without crashing.
  return { label: fallback(verdict), tone: "amber" };
}

/**
 * Humanize a substrate severity into a customer-facing label + tone.
 *
 * Three substrate tiers (`high` / `medium` / `low`) collapse to two
 * visible tiers in the default case: high+medium → "Worth adjusting"
 * (amber), low → "Quick polish" (stone). The collapse is intentional —
 * most users don't need to distinguish the high/medium boundary; the
 * confidence-derived split is substrate granularity.
 *
 * The "Don't ship" + red-tone path is reserved for genuine ship-
 * blockers (profanity, trademark, security). It requires a hard-rule
 * signal that today's schema 2.0 envelope doesn't carry — pass
 * `isShipBlocker: true` to surface it once the envelope grows that
 * field. For now the default amber/stone paths cover every finding.
 */
export function humanizeSeverity(
  severity: string,
  isShipBlocker = false,
): { label: string; tone: CustomerToneSeverity } {
  if (isShipBlocker && severity === "high") {
    return { label: "Don't ship", tone: "red" };
  }
  if (severity === "high" || severity === "medium") {
    return { label: "Worth adjusting", tone: "amber" };
  }
  if (severity === "low") {
    return { label: "Quick polish", tone: "stone" };
  }
  // Defensive fallback for unknown severity keyword.
  return { label: fallback(severity), tone: "stone" };
}
