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


# ---------------------------------------------------------------------------
# Standard ID → customer-facing CATEGORY (schema 2.5.0)
#
# Findings on the Document-tier dashboard are grouped by category
# instead of rendered as a flat list. The category mapping is the
# customer-facing taxonomy on the public envelope. Substrate
# standard_ids stay private (per ADR 2026-04-25); customers see the
# category label only.
#
# When adding a new standard, add its category here. The fallback for
# unknown / LLM-emitted findings without a standard_id is "Big picture"
# — those are document-shape observations (incoherence, idiom-rich,
# wall-of-text) that don't map to a specific rule.
# ---------------------------------------------------------------------------

# Customer-facing category labels. The mapping has six buckets:
#   - Big picture: document-shape observations from the LLM scan
#   - Voice & tone: hedging, jargon, register, action verbs
#   - Mechanics: grammar, conventions, proofing
#   - Structure: sentence length, paragraph layout
#   - Accessibility: link text, device verbs, alt text, etc.
#   - Inclusion: gendered language, non-inclusive terminology
#
# Buckets are intentionally few — too many categories defeats the
# purpose of grouping. If a customer can't choose between five
# meaningful buckets in two seconds, the grouping isn't helping.
STANDARD_CATEGORY: dict[str, str] = {
    # Voice & tone — speaks to *how* the content sounds.
    "VT-01": "Voice & tone",
    "VT-02": "Voice & tone",
    "VT-03": "Voice & tone",
    "VT-04": "Voice & tone",
    "VT-05": "Voice & tone",
    "VT-06": "Voice & tone",
    "VT-07": "Voice & tone",
    "ACT-01": "Voice & tone",
    "ACT-02": "Voice & tone",
    "ACT-03": "Voice & tone",
    "ACT-04": "Voice & tone",
    "CLR-01": "Voice & tone",  # plain language / banned words
    "CLR-02": "Voice & tone",  # lead with most important info
    "CLR-04": "Voice & tone",
    "CLR-05": "Voice & tone",
    "CLR-06": "Voice & tone",  # short words
    "CLR-07": "Voice & tone",  # benefit-first (P2)
    "PRF-11": "Voice & tone",  # dismissive language

    # Mechanics — grammar, punctuation, conventions, proofing.
    "GRM-01": "Mechanics",
    "GRM-02": "Mechanics",
    "GRM-03": "Mechanics",
    "GRM-04": "Mechanics",
    "GRM-05": "Mechanics",
    "GRM-06": "Mechanics",
    "GRM-07": "Mechanics",
    "GRM-08": "Mechanics",
    "CON-01": "Mechanics",
    "CON-02": "Mechanics",
    "CON-03": "Mechanics",
    "CON-04": "Mechanics",
    "CON-05": "Mechanics",
    "PRF-01": "Mechanics",
    "PRF-02": "Mechanics",
    "PRF-03": "Mechanics",
    "PRF-04": "Mechanics",
    "PRF-05": "Mechanics",
    "PRF-06": "Mechanics",
    "PRF-07": "Mechanics",
    "PRF-08": "Mechanics",
    "PRF-09": "Mechanics",
    "PRF-10": "Mechanics",

    # Structure — sentence length, paragraph layout, hierarchy.
    "CLR-03": "Structure",
    "STR-01": "Structure",
    "STR-02": "Structure",
    "STR-03": "Structure",
    "STR-04": "Structure",
    "STR-05": "Structure",
    "STR-06": "Structure",
    "STR-07": "Structure",  # mobile readable (P2)

    # Accessibility — vague link text, device verbs, alt text.
    "ACC-01": "Accessibility",
    "ACC-02": "Accessibility",
    "ACC-03": "Accessibility",
    "ACC-04": "Accessibility",
    "ACC-05": "Accessibility",
    "ACC-06": "Accessibility",
    "ACC-07": "Accessibility",
    "ACC-08": "Accessibility",  # device verbs (v4.7.1)

    # Inclusion — gendered language, non-inclusive terminology.
    "INC-01": "Inclusion",
    "INC-02": "Inclusion",

    # Translation readiness folds into Mechanics — these are typically
    # syntactic/punctuation issues that hurt MT and i18n. Keeping it
    # under Mechanics avoids a 7th bucket the customer doesn't need.
    "TRN-01": "Mechanics",
    "TRN-02": "Mechanics",
    "TRN-03": "Mechanics",
    "TRN-04": "Mechanics",
    "TRN-05": "Mechanics",
    "TRN-06": "Mechanics",
    "TRN-07": "Mechanics",
}

# Default category for findings without a standard_id (LLM-emitted
# document-shape observations) or with an unrecognized standard_id.
# Big picture findings render with a distinct visual treatment in the
# UI — they're observations, not anchored line edits.
DEFAULT_CATEGORY = "Big picture"


def get_category(standard_id: str | None) -> str:
    """Return the customer-facing category for a standard ID.

    Defaults to "Big picture" for findings without a standard_id (LLM-
    emitted document-shape observations) or with an unrecognized
    standard_id. The default keeps the engine forward-compatible —
    new standards added later get categorized as Big picture until the
    map is updated, rather than crashing the public projection.
    """
    if not standard_id:
        return DEFAULT_CATEGORY
    return STANDARD_CATEGORY.get(standard_id, DEFAULT_CATEGORY)


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
