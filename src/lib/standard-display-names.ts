/**
 * Standard ID → customer-facing display label.
 *
 * Mirrors `DISPLAY_LABELS` in `src/content_checker/labels.py`. Both
 * maps must stay synchronized — `scripts/check-display-labels-parity.ts`
 * (and the parallel scripts in mcp-server / cli-client when those land)
 * enforce that. When you add a standard:
 *
 *   1. Add to `src/content_checker/standards/private/standards_library.json`
 *   2. Add to `DISPLAY_LABELS` in `src/content_checker/labels.py`
 *   3. Add to `STANDARD_DISPLAY_LABELS` here
 *   4. Add to the equivalent maps in `mcp-server/` and `cli-client/`
 *      (separate packages, can't import from this one)
 *
 * The labels themselves are intentionally short (1–3 words) and
 * category-flavored — same label can apply to multiple rules. The
 * full rule text disambiguates on customer surfaces; the label
 * exists so customer surfaces don't have to render substrate IDs.
 *
 * Why this lives in TS instead of being computed from the substrate
 * JSON: the labels are a curated copy artifact, not a derived value.
 * The `rule` field is too long to use as a label, and the category
 * field (Voice & tone / Mechanics / Structure / etc.) is even
 * coarser than these labels.
 */

export const STANDARD_DISPLAY_LABELS: Record<string, string> = {
  // Grammar and mechanics
  "GRM-01": "Punctuation",
  "GRM-02": "Abbreviations",
  "GRM-03": "Punctuation",
  "GRM-04": "Punctuation",
  "GRM-05": "Numerals",

  // Consistency
  "CON-01": "Terminology",
  "CON-02": "Casing",
  "CON-03": "Date format",
  "CON-04": "Terminology",

  // Clarity
  "CLR-01": "Clarity",
  "CLR-02": "Clarity",
  "CLR-03": "Sentence length",

  // Voice and tone
  "VT-01": "Voice",
  "VT-02": "Voice",
  "VT-03": "Tone",
  "VT-04": "Tone",
  "VT-05": "Empathy",

  // Structure
  "STR-01": "Structure",
  "STR-02": "Structure",
  "STR-03": "Structure",
  "STR-04": "Hierarchy",
  "STR-05": "Lists",

  // Actionability
  "ACT-01": "Action verbs",
  "ACT-02": "Action verbs",

  // Accessibility
  "ACC-01": "Accessibility",
  "ACC-02": "Accessibility",
  "ACC-03": "Accessibility",
  "ACC-04": "Accessibility",
  "ACC-05": "Alt text",
  "ACC-06": "Accessibility",
  "ACC-07": "Form labels",

  // Inclusivity
  "INC-01": "Inclusive language",
  "INC-02": "Inclusive language",

  // Translation readiness
  "TRN-01": "Translation",
  "TRN-02": "Translation",

  // Proofing (deterministic preprocessor checks)
  "PRF-01": "Proofing",
  "PRF-02": "Proofing",
  "PRF-03": "Proofing",
  "PRF-04": "Proofing",
  "PRF-05": "Proofing",
  "PRF-06": "Proofing",
  "PRF-07": "Proofing",
  "PRF-08": "Placeholder",
  "PRF-09": "Readability",
  "PRF-10": "Accessibility",
  "PRF-11": "Tone",
};

/**
 * Return the human-readable display label for a standard ID.
 *
 * Falls back to the input `standardId` so:
 *   - Unknown engine IDs (e.g. a new standard added before the map
 *     was updated) degrade gracefully
 *   - User-generated team-rule IDs (TEAM-01 etc.) pass through —
 *     they are NOT substrate and remain visible to their author
 */
export function displayLabelFor(standardId: string): string {
  return STANDARD_DISPLAY_LABELS[standardId] ?? standardId;
}
