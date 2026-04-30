"""Content audience signal for the content standards checker.

Defines the two audience modes and their effects on the pipeline:

    product_ui  — Default. Full standards enforcement. The content is
                  user-facing product UI (buttons, labels, error messages,
                  tooltips, onboarding flows). Every standard applies.

    general     — Relaxed. The content is a presentation, internal doc,
                  marketing page, or other non-UI context. UI-specific
                  standards are suppressed; universal quality standards
                  (grammar, proofing, clarity, inclusion) still apply.

The audience signal propagates through the pipeline via a simple string
parameter. Each stage that needs it checks the value and adjusts behavior:

    filter   → excludes product_ui-only standards in general mode
    preprocess → ACT-01 returns PASS unconditionally in general mode
    pipeline → threads audience into the system prompt for LLM context
    export   → includes audience in triage metadata for evaluation tracking

Design decisions:
    - The filter gatekeeps, not the standards library. UI-specific standard
      IDs are defined here in code rather than adding audience_scope metadata
      to standards_library.json. This keeps the JSON file stable (never
      replace wholesale) and makes the gating logic testable and reviewable.
    - The default is always "product_ui" — callers that don't pass an
      audience get exactly the current behavior. Zero breaking changes.
    - The list of UI-specific standards is intentionally small. When in
      doubt, a standard stays universal. Suppressions are individually
      justified by triage data.
"""

from __future__ import annotations

from enum import Enum
from typing import Final

from content_checker.standards.loader import load_ui_specific_standards


# ---------------------------------------------------------------------------
# Audience types
# ---------------------------------------------------------------------------

class Audience(str, Enum):
    """Content audience modes.

    String enum so it serializes cleanly to JSON and can be used
    directly as a dict key or function parameter without .value.
    """

    PRODUCT_UI = "product_ui"
    GENERAL = "general"

    @classmethod
    def from_str(cls, value: str) -> "Audience":
        """Parse an audience string, defaulting to PRODUCT_UI for unknown values.

        Accepts case-insensitive input. Unrecognized values default to
        PRODUCT_UI rather than raising, because the safe default is full
        standards enforcement.
        """
        normalized = value.strip().lower()
        try:
            return cls(normalized)
        except ValueError:
            return cls.PRODUCT_UI


# ---------------------------------------------------------------------------
# UI-specific standards: suppressed in general mode
# ---------------------------------------------------------------------------
#
# The set of standard IDs and the per-entry rationales live in the
# private substrate at standards/private/ui_specific_standards.json
# (ADR 2026-04-25, substrate-extraction follow-up 2026-04-30). Loaded
# at module-import time and cached. Standards NOT on this list apply
# universally regardless of audience.
#
# To add a new suppression:
#   1. Identify the standard causing false positives in non-UI content
#   2. Verify with triage data (must have ≥3 confirmed context_gap cases)
#   3. Add the entry to ui_specific_standards.json in the private
#      substrate repo with a one-line rationale
#   4. Add a test case in test_audience.py
#   5. Note the addition in the internal architecture doc.

UI_SPECIFIC_STANDARDS: Final[frozenset[str]] = load_ui_specific_standards()


# ---------------------------------------------------------------------------
# Audience-aware system prompt context
# ---------------------------------------------------------------------------

_AUDIENCE_PROMPT_CONTEXT: Final[dict[Audience, str]] = {
    Audience.PRODUCT_UI: (
        "This content is **user-facing product UI** — buttons, labels, "
        "error messages, tooltips, and in-product flows. Apply all "
        "content standards with full rigor."
    ),
    Audience.GENERAL: (
        "This content is **general written content** — a presentation, "
        "document, marketing page, or internal material. It is NOT "
        "product UI copy.\n\n"
        "Apply universal quality standards (grammar, proofing, clarity, "
        "inclusion) but do NOT enforce UI-specific conventions like "
        "requiring imperative verbs on headings, sentence case rules, "
        "or UI-label punctuation norms. Title case in headings, trailing "
        "periods on complete-sentence headings, and non-imperative "
        "instructional phrasing are all acceptable in this context."
    ),
}


def get_audience_prompt_context(audience: Audience) -> str:
    """Return the system prompt paragraph for the given audience mode.

    This text is injected into the system prompt after the content type
    line. It calibrates the LLM's judgment for the audience context.
    """
    return _AUDIENCE_PROMPT_CONTEXT.get(audience, _AUDIENCE_PROMPT_CONTEXT[Audience.PRODUCT_UI])


def is_standard_active(standard_id: str, audience: Audience) -> bool:
    """Check whether a standard should be evaluated for the given audience.

    Returns True for all standards in product_ui mode.
    Returns False for UI-specific standards in general mode.
    Universal standards always return True.
    """
    if audience == Audience.PRODUCT_UI:
        return True
    return standard_id not in UI_SPECIFIC_STANDARDS
