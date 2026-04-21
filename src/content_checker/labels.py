"""Human-readable display labels for content standards.

Every standard ID maps to a single scannable word or short phrase
that tells the user what to fix. These labels are the primary
visual identifier in all output surfaces — the Figma plugin, the
CLI, the eval runner, and any future API.

The standard ID (e.g., CON-02) still appears as secondary reference
text for traceability. But the display label is what the user's
eye hits first.

Design principles:
    - One word when possible, two at most.
    - Describes what to fix, not the category of problem.
      "Casing" tells you what to look at. "Consistency" doesn't.
    - Same label regardless of output surface. If the plugin says
      "Casing" and the CLI says "CON-02", users lose trust.
"""

from __future__ import annotations


# ---------------------------------------------------------------------------
# Standard ID → display label mapping
#
# Organized by category for maintainability. When a new standard is
# added, add its label here. The get_display_label() function falls
# back to the standard ID if no label is defined, so missing entries
# degrade gracefully rather than crashing.
# ---------------------------------------------------------------------------

DISPLAY_LABELS: dict[str, str] = {
    # Grammar and mechanics
    "GRM-01": "Punctuation",
    "GRM-02": "Abbreviations",
    "GRM-03": "Punctuation",
    "GRM-04": "Punctuation",
    "GRM-05": "Numerals",

    # Consistency
    "CON-01": "Terminology",
    "CON-02": "Casing",
    "CON-03": "Date format",
    "CON-04": "Terminology",

    # Clarity
    "CLR-01": "Clarity",
    "CLR-02": "Clarity",
    "CLR-03": "Sentence length",

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

    # Actionability
    "ACT-01": "Action verbs",
    "ACT-02": "Action verbs",

    # Accessibility
    "ACC-01": "Accessibility",
    "ACC-02": "Accessibility",
    "ACC-03": "Accessibility",
    "ACC-04": "Accessibility",
    "ACC-05": "Alt text",
    "ACC-06": "Accessibility",
    "ACC-07": "Form labels",

    # Inclusivity
    "INC-01": "Inclusive language",
    "INC-02": "Inclusive language",

    # Translation readiness
    "TRN-01": "Translation",
    "TRN-02": "Translation",

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


def get_display_label(standard_id: str) -> str:
    """Return the human-readable display label for a standard ID.

    Falls back to the standard ID itself if no label is defined.
    This ensures new standards degrade gracefully — they show their
    ID until someone adds a label.
    """
    return DISPLAY_LABELS.get(standard_id, standard_id)


def get_display_label_with_id(standard_id: str) -> str:
    """Return the display label with the standard ID as a suffix.

    Example: "Casing (CON-02)"

    Useful for CLI output and eval reports where users need both
    the scannable label and the precise reference.
    """
    label = DISPLAY_LABELS.get(standard_id, None)
    if label:
        return f"{label} ({standard_id})"
    return standard_id


# ---------------------------------------------------------------------------
# Proper noun grey area detection
#
# When CON-02 flags title case, the flagged text might contain branded
# terms or proper nouns that are intentionally capitalized. Rather than
# trying to maintain a word list of every proper noun (doesn't scale),
# the system detects the ambiguity and lets the user decide.
#
# Detection: 2+ consecutive capitalized words that aren't at the start
# of a sentence. "Opendoor Expert" triggers this. "Your account" doesn't.
# ---------------------------------------------------------------------------

import re

_CONSECUTIVE_CAPS = re.compile(
    r"(?<!\. )(?<!\.\s)(?<!^)"   # not at sentence start
    r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)",  # 2+ capitalized words in a row
)


def detect_possible_proper_nouns(text: str) -> list[str]:
    """Find sequences of capitalized words that might be proper nouns.

    Returns a list of candidate phrases (e.g., ["Opendoor Expert"]).
    Empty list if no candidates found.
    """
    # Don't flag single-word strings or very short text
    if len(text.split()) <= 2:
        return []

    matches = _CONSECUTIVE_CAPS.findall(text)
    return [m.strip() for m in matches if m.strip()]


def enrich_casing_suggestion(
    standard_id: str,
    suggestion: str,
    original_text: str,
) -> str:
    """Enrich a CON-02 violation suggestion with proper noun awareness.

    When the flagged text contains what might be a proper noun or
    branded term, appends guidance that acknowledges the grey area
    and lets the user decide.

    Returns the original suggestion unchanged for non-CON-02 violations
    or when no proper noun candidates are found.
    """
    if standard_id != "CON-02":
        return suggestion

    candidates = detect_possible_proper_nouns(original_text)
    if not candidates:
        return suggestion

    # Build the grey area acknowledgment
    if len(candidates) == 1:
        noun_phrase = f"'{candidates[0]}'"
        qualifier = "a branded term or proper noun"
    else:
        noun_phrase = ", ".join(f"'{c}'" for c in candidates)
        qualifier = "branded terms or proper nouns"

    enrichment = (
        f"\n\nNote: if {noun_phrase} is {qualifier} at your organization, "
        f"the title case is correct — dismiss this check."
    )

    return suggestion + enrichment
