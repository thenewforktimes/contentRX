"""Standard ID → customer-facing display label.

Mirrors `DISPLAY_LABELS` in `src/content_checker/labels.py`. This
package can't import from `content_checker` (per CLAUDE.md — the
CLI is a thin HTTP client). The mirror exists so CLI output can
render display labels without leaking substrate IDs per ADR
2026-04-25.

Keep this map in lockstep with:
  - src/content_checker/labels.py:DISPLAY_LABELS (engine — source of truth)
  - mcp-server/src/contentrx_mcp/display_labels.py
  - src/lib/standard-display-names.ts

`scripts/check-display-labels-parity.py` parses all four and
fails CI on divergence.
"""

from __future__ import annotations

DISPLAY_LABELS: dict[str, str] = {
    # Grammar and mechanics
    "GRM-01": "Punctuation",
    "GRM-02": "Abbreviations",
    "GRM-03": "Punctuation",
    "GRM-04": "Punctuation",
    "GRM-05": "Numerals",
    "GRM-06": "Hyphenation",
    "GRM-07": "Em dashes",

    # Consistency
    "CON-01": "Terminology",
    "CON-02": "Casing",
    "CON-03": "Date format",
    "CON-04": "Terminology",
    "CON-05": "Product names",

    # Clarity
    "CLR-01": "Clarity",
    "CLR-02": "Clarity",
    "CLR-03": "Sentence length",
    "CLR-04": "One idea per sentence",
    "CLR-05": "Plain phrasing",

    # Voice and tone
    "VT-01": "Voice",
    "VT-02": "Voice",
    "VT-03": "Tone",
    "VT-04": "Tone",
    "VT-05": "Empathy",

    # Structure
    "STR-01": "Structure",
    "STR-02": "Structure",
    "STR-03": "Structure",
    "STR-04": "Hierarchy",
    "STR-05": "Lists",
    "STR-06": "Heading hierarchy",

    # Actionability
    "ACT-01": "Action verbs",
    "ACT-02": "Action verbs",
    "ACT-03": "Constructive framing",
    "ACT-04": "Next step",

    # Accessibility
    "ACC-01": "Accessibility",
    "ACC-02": "Accessibility",
    "ACC-03": "Accessibility",
    "ACC-04": "Accessibility",
    "ACC-05": "Alt text",
    "ACC-06": "Accessibility",
    "ACC-07": "Form labels",
    "ACC-08": "Device-neutral verbs",

    # Inclusivity
    "INC-01": "Inclusive language",
    "INC-02": "Inclusive language",

    # Translation readiness
    "TRN-01": "Translation",
    "TRN-02": "Translation",
    "TRN-03": "Translation",
    "TRN-04": "Translation",
    "TRN-05": "Translation",
    "TRN-06": "Translation",
    "TRN-07": "Translation",

    # Proofing (deterministic preprocessor checks)
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
}


def display_label_for(standard_id: str | None) -> str:
    """Return the human-readable display label for a standard ID.

    Falls back to the input itself for unknown engine IDs (graceful
    degradation when a new standard ships before the map is updated)
    and for user-generated team-rule IDs (TEAM-NN — those are not
    substrate and remain visible to their author). Returns "" for
    None.
    """
    if not standard_id:
        return ""
    return DISPLAY_LABELS.get(standard_id, standard_id)
