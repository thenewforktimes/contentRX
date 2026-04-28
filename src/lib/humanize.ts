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
