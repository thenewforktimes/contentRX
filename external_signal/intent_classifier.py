"""Commit-message intent classifier — human-eval build plan Session 18.

Tags each mined commit with one of six intent categories to prioritize
Robert's review. Pure regex — the plan spec allows a fine-tuned
sentence-transformer but commit messages have strong enough structure
that regex carries the 80th-percentile case cleanly, and regex is
deterministic + debuggable without an ML stack.

The six categories:

    typo_fix         spelling / grammar fix on existing copy
    clarification    making copy clearer without changing meaning
    tone_shift       adjusting voice / register / warmth
    restructure      reorganizing copy; moving / consolidating / rewriting
    i18n_motivated   i18n- or translator-driven change
    unknown          classifier can't decide

Intent → triage_category mapping (documented, not enforced):

    typo_fix         → `correct`           (engine would flag same way)
    clarification    → `missing_standard`  (the rule may need strengthening)
    tone_shift       → `missing_standard`  (may point at a VT gap)
    restructure      → `context_gap`       (something larger is at play)
    i18n_motivated   → TRN-* family        (translation-readiness standards)
    unknown          → no guidance; Robert reviews without prior

Usage:
    from external_signal.intent_classifier import classify_intent

    intent = classify_intent("fix: typo in welcome email")
    # → "typo_fix"
"""

from __future__ import annotations

import re
from typing import Literal

IntentCategory = Literal[
    "typo_fix",
    "clarification",
    "tone_shift",
    "restructure",
    "i18n_motivated",
    "unknown",
]

VALID_INTENT_CATEGORIES: tuple[IntentCategory, ...] = (
    "typo_fix",
    "clarification",
    "tone_shift",
    "restructure",
    "i18n_motivated",
    "unknown",
)


# ---------------------------------------------------------------------------
# Classification patterns
# ---------------------------------------------------------------------------
#
# Order matters — earlier patterns win. i18n is the most specific
# (explicit prefix or translator mention); unknown is the fallback.

# i18n: prefix or translator-focused language.
I18N_RE = re.compile(
    r"""
    ^i18n[(:]              # i18n: or i18n(scope):
    | ^l10n[(:]            # l10n: or l10n(scope):
    | ^translations?[(:]   # translations: or translation:
    | \btranslat(?:ion|or|e)s?\b
    | \blocale?s?\b
    | \bl10n\b
    | \bi18n\b
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Typo / spelling / grammar fix.
TYPO_RE = re.compile(
    r"""
    \btypo\b
    | \bspell(?:ing)?\b
    | \bmisspelled?\b
    | \bmispelled?\b       # the misspelled misspelling
    | \bgrammar\b
    | \bpunctuation\b
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Tone shift — voice/register changes.
TONE_RE = re.compile(
    r"""
    \btone\b
    | \bvoice\b
    | \bsoften(?:ing)?\b
    | \bfriendli(?:er|ness)\b
    | \b(?:less|more)\s+(?:technical|formal|casual|warm)\b
    | \bapproachable\b
    | \bconversational\b
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Clarification — making copy clearer without changing structure.
CLARIFICATION_RE = re.compile(
    r"""
    \bclarify\b
    | \bclarif(?:y|ication|ies)\b
    | \bclearer\b
    | \bclarity\b
    | \bunclear\b
    | \bdisambiguat(?:e|ion|ing)\b
    | \bexplain\b
    | \breword\b
    | \brephras(?:e|ing|ed)\b
    | \bsimplif(?:y|ication|ies|ied)\b
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Restructure — moving / consolidating / substantial rewrite.
RESTRUCTURE_RE = re.compile(
    r"""
    \brewrit(?:e|ing|ten)\b
    | \brestructur(?:e|ing|ed)\b
    | \breorganiz(?:e|ation|ing|ed)\b
    | \bconsolidat(?:e|ion|ing|ed)\b
    | \bsplit\b.*\b(?:up|section|paragraph)\b
    | \bmerge[d]?\b.*\b(?:docs?|section|paragraph|page)s?\b
    | \bcollaps(?:e|ed|ing)\b.*\b(?:section|heading)s?\b
    """,
    re.IGNORECASE | re.VERBOSE,
)


# Pattern list with priorities. Highest priority first.
_CLASSIFIERS: list[tuple[IntentCategory, re.Pattern]] = [
    ("i18n_motivated", I18N_RE),
    ("typo_fix", TYPO_RE),
    ("tone_shift", TONE_RE),
    ("clarification", CLARIFICATION_RE),
    ("restructure", RESTRUCTURE_RE),
]


def classify_intent(message: str) -> IntentCategory:
    """Return the best intent category for a commit message.

    Pure function — same input always yields the same output. No
    network calls, no state, no file IO. Returns `"unknown"` when no
    pattern matches.
    """
    if not message:
        return "unknown"
    for category, pattern in _CLASSIFIERS:
        if pattern.search(message):
            return category
    return "unknown"


# ---------------------------------------------------------------------------
# Intent → triage_category mapping
# ---------------------------------------------------------------------------

# This is a reference table for Robert's review, NOT enforced. The plan
# spec is explicit: "The mapping is documented, not enforced — the
# intent is to give Robert a lens into what kind of signal each external
# pair represents."
#
# Robert's review reconciles each pair's actual triage_category based
# on inspection; this prior just gives the queue a reasonable starting
# sort.
INTENT_TO_TRIAGE: dict[IntentCategory, str] = {
    "typo_fix": "correct",
    "clarification": "missing_standard",
    "tone_shift": "missing_standard",
    "restructure": "context_gap",
    "i18n_motivated": "TRN",  # points at the TRN-* family; specific rule
                                # assignment happens at review time
    "unknown": "unknown",
}


def suggested_triage_category(intent: IntentCategory) -> str:
    """The *typical* triage_category this intent maps to. Prior, not
    a promise."""
    return INTENT_TO_TRIAGE.get(intent, "unknown")
