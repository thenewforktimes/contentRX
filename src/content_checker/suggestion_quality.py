"""Post-process gate for LLM-generated suggestion text.

The scan prompt (pipeline.py) teaches the LLM what good suggestions look
like and lists hard rules ("no em dashes," "no hedging filler," "no AI-
assistant tone"). The LLM mostly obeys, but on inputs that ARE error
messages (e.g. "Unable to complete operation. Please contact
administrator.") it sometimes falls back to AI-assistant slop —
"Our support team can help — contact your administrator for assistance"
and the like.

This module is the deterministic safety net. After the scan/validate
pipeline produces violations, we screen each LLM-source suggestion
against a conservative slop detector. When a slip is detected, we
replace the suggestion with an audience-aware generic fallback that
names the next action and points somewhere — calm, plain language,
not silence.

Design notes:
    - Conservative detection: only the egregious cases trip a
      replacement. False positives mean a good LLM suggestion gets
      overwritten by the generic fallback, which is worse than letting
      a borderline-OK suggestion through.
    - Audience-aware: PRODUCT_UI gets the "Try again, and contact
      [admin/support] if there's still trouble" fallback. GENERAL
      audience (presentations, docs, marketing) leaves the LLM output
      alone — the fallback's framing doesn't fit non-UI content.
    - Original-aware: when the original copy already mentions "admin"
      or "support" or "team", the fallback echoes that same pointer
      so the suggestion stays grounded in the customer's vocabulary.
    - LLM-source only: preprocessor violations carry hand-tuned
      suggestions written by the engine authors. We trust those by
      design and skip them.
"""

from __future__ import annotations

from content_checker.audience import Audience
from content_checker.models import Violation


_BANNED_PHRASES: tuple[str, ...] = (
    # AI-assistant tone — the prompt's "Slop vs good" examples explicitly
    # call these out. Lowercase for case-insensitive match.
    "our support team",
    "please feel free to",
    "rest assured",
    "great news",
    "don't worry",
    "sorry, but",
)

# Length-runaway threshold. The slop example in the scan prompt is 3x
# the input. We only enforce on short inputs (<= 60 chars) where 3x is
# unambiguously slop; longer inputs can legitimately produce expanded
# rewrites without crossing into runaway territory.
_LENGTH_RATIO_THRESHOLD = 3.0
_LENGTH_THRESHOLD_INPUT_CHARS = 60


def is_slop(
    suggestion: str,
    original: str | None = None,
) -> tuple[bool, str]:
    """Return (True, reason) when the suggestion fails the slop screen.

    The `reason` string is for telemetry and tests; it's never user-
    facing. Returns (False, "") for suggestions that pass the screen.

    Conservative on purpose. When in doubt, the suggestion passes.

    Em dashes are unconditionally stripped from LLM suggestions.
    ContentRX-generated rewrites never contain em dashes; the prior
    "echo exception" (let the suggestion keep an em dash if the user's
    input had one) was dropped because we don't surface em dashes to
    the customer as a violation, but we also don't propagate them in
    our suggestions.
    """
    if not suggestion or not suggestion.strip():
        return True, "empty"

    s_lower = suggestion.lower()

    if "—" in suggestion:
        return True, "em_dash"

    for phrase in _BANNED_PHRASES:
        if phrase in s_lower:
            return True, f"banned_phrase:{phrase}"

    if original:
        original_len = len(original)
        if 0 < original_len <= _LENGTH_THRESHOLD_INPUT_CHARS:
            if len(suggestion) >= original_len * _LENGTH_RATIO_THRESHOLD:
                return True, "runaway_length"

    return False, ""


def audience_aware_fallback(
    audience: Audience,
    original: str | None = None,
) -> str:
    """Return the deterministic fallback suggestion for this audience.

    PRODUCT_UI → "Something's not right. Try again, and contact
    [admin/support] if there's still trouble." The pointer adapts to
    whichever the original copy mentioned (admin, support, help, team).
    Default pointer when nothing matches is "support."

    GENERAL → empty string. The "contact your admin" framing doesn't
    fit marketing pages, presentations, or internal docs. Returning
    empty signals the caller NOT to replace — leaving the LLM's
    suggestion alone is the better default for non-UI content.
    """
    if audience == Audience.GENERAL:
        return ""

    pointer = "support"
    if original:
        ol = original.lower()
        if "admin" in ol:
            pointer = "your admin"
        elif "support" in ol or "help" in ol or "team" in ol:
            pointer = "support"

    return (
        f"Something's not right. Try again, and contact {pointer} "
        "if there's still trouble."
    )


def sanitize_violation(
    violation: Violation,
    original_text: str,
    audience: Audience,
) -> bool:
    """Replace a slop suggestion with the audience-aware fallback.

    Mutates `violation.suggestion` in place. Returns True iff the
    suggestion was replaced.

    Skips preprocessor-source violations — those carry hand-tuned
    suggestions from the engine authors that we trust by design.
    """
    if violation.source != "llm":
        return False

    is_bad, _reason = is_slop(violation.suggestion, original=original_text)
    if not is_bad:
        return False

    fallback = audience_aware_fallback(audience, original=original_text)
    if not fallback:
        # GENERAL audience: leave the LLM's output alone rather than
        # substitute a fallback that doesn't fit the content type.
        return False

    violation.suggestion = fallback
    return True


def sanitize_violations(
    violations: list[Violation],
    original_text: str,
    audience: Audience,
) -> int:
    """Apply the slop screen to a list of violations in place.

    Returns the number of suggestions replaced — used by the pipeline
    to populate `PipelineMeta.suggestions_replaced` for observability.
    """
    return sum(
        1 for v in violations
        if sanitize_violation(v, original_text, audience)
    )
