"""Tests for the suggestion-quality slop screen.

The screen catches LLM-generated suggestions that fall into the
"slop" patterns the scan prompt explicitly bans (em dashes, hedging
filler, AI-assistant tone, runaway length) and replaces them with
the audience-aware deterministic fallback.

Test strategy:
    - Each banned pattern fires individually
    - Clean suggestions pass through untouched
    - Audience-aware fallback content varies by audience + original text
    - Pipeline integration: a slop suggestion gets the fallback
    - Preprocessor suggestions are never touched (hand-tuned, trusted)
"""

from __future__ import annotations

from content_checker.audience import Audience
from content_checker.models import Violation
from content_checker.suggestion_quality import (
    audience_aware_fallback,
    is_slop,
    sanitize_violation,
    sanitize_violations,
)


# ---------------------------------------------------------------------------
# is_slop
# ---------------------------------------------------------------------------


class TestIsSlopEmpty:
    def test_empty_string(self):
        is_bad, reason = is_slop("")
        assert is_bad
        assert reason == "empty"

    def test_whitespace_only(self):
        is_bad, reason = is_slop("   \n  ")
        assert is_bad
        assert reason == "empty"


class TestIsSlopEmDash:
    def test_em_dash_in_suggestion_not_in_original(self):
        is_bad, reason = is_slop(
            "Save changes — your draft will be preserved.",
            original="Save",
        )
        assert is_bad
        assert reason == "em_dash"

    def test_em_dash_in_original_still_slop(self):
        # v4.7.2: the prior "echo exception" was removed. ContentRX-
        # generated rewrites never contain em dashes, regardless of
        # what the customer's original input had.
        is_bad, reason = is_slop(
            "Save your work — drafts auto-save every minute.",
            original="Save your work — drafts auto-save",
        )
        assert is_bad
        assert reason == "em_dash"

    def test_em_dash_no_original_provided(self):
        # No original supplied → conservative: treat em dash as slop.
        is_bad, reason = is_slop("Try again — it should work now.")
        assert is_bad
        assert reason == "em_dash"


class TestIsSlopBannedPhrases:
    def test_our_support_team(self):
        is_bad, reason = is_slop(
            "Our support team can help. Contact us anytime.",
        )
        assert is_bad
        assert "our support team" in reason

    def test_please_feel_free_to(self):
        is_bad, reason = is_slop(
            "Please feel free to reach out with any questions.",
        )
        assert is_bad
        assert "please feel free to" in reason

    def test_rest_assured(self):
        is_bad, reason = is_slop("Rest assured, we've got this handled.")
        assert is_bad
        assert "rest assured" in reason

    def test_great_news(self):
        is_bad, reason = is_slop("Great news! Your file is ready.")
        assert is_bad
        assert "great news" in reason

    def test_dont_worry(self):
        is_bad, reason = is_slop("Don't worry, your data is safe.")
        assert is_bad
        assert "don't worry" in reason

    def test_sorry_but(self):
        is_bad, reason = is_slop("Sorry, but we couldn't process that.")
        assert is_bad
        assert "sorry, but" in reason

    def test_case_insensitive(self):
        is_bad, _ = is_slop("OUR SUPPORT TEAM is standing by.")
        assert is_bad


class TestIsSlopRunawayLength:
    def test_3x_short_input_is_slop(self):
        # 30-char input → 90+ char suggestion is runaway
        original = "Click here"  # 10 chars
        suggestion = "Please click here to learn more about our pricing options today."
        is_bad, reason = is_slop(suggestion, original=original)
        assert is_bad
        assert reason == "runaway_length"

    def test_2x_short_input_is_fine(self):
        # 2x is within bounds; threshold is 3x.
        original = "Click here"
        suggestion = "Click here to view pricing."
        is_bad, _ = is_slop(suggestion, original=original)
        assert not is_bad

    def test_long_input_no_runaway_check(self):
        # Inputs over 60 chars: length-runaway check is skipped (legit
        # rewrites of paragraphs can run longer).
        original = "x" * 100
        suggestion = "y" * 350
        is_bad, _ = is_slop(suggestion, original=original)
        assert not is_bad

    def test_no_original_no_runaway_check(self):
        # Without an original to compare against, length isn't checked.
        is_bad, _ = is_slop("This is a perfectly reasonable suggestion.")
        assert not is_bad


class TestIsSlopCleanCases:
    def test_short_imperative_passes(self):
        is_bad, _ = is_slop("View pricing", original="Click here")
        assert not is_bad

    def test_engine_good_example_passes(self):
        # The "Good" example from the prompt's slop-vs-good comparison.
        original = "Unable to complete operation. Please contact administrator."
        suggestion = (
            "Something's wrong and it's unclear what. Try again, "
            "and contact your admin if there's still trouble."
        )
        is_bad, _ = is_slop(suggestion, original=original)
        assert not is_bad


# ---------------------------------------------------------------------------
# audience_aware_fallback
# ---------------------------------------------------------------------------


class TestFallback:
    def test_product_ui_default_pointer(self):
        out = audience_aware_fallback(Audience.PRODUCT_UI)
        assert "support" in out
        assert "Try again" in out

    def test_product_ui_admin_pointer_when_original_says_admin(self):
        out = audience_aware_fallback(
            Audience.PRODUCT_UI,
            original="Please contact administrator.",
        )
        assert "your admin" in out

    def test_product_ui_support_pointer_when_original_says_support(self):
        out = audience_aware_fallback(
            Audience.PRODUCT_UI,
            original="Contact support if you need help.",
        )
        assert "support" in out
        assert "your admin" not in out

    def test_general_returns_empty(self):
        # GENERAL audience: don't substitute. The fallback's framing
        # doesn't fit non-UI content.
        out = audience_aware_fallback(Audience.GENERAL)
        assert out == ""


# ---------------------------------------------------------------------------
# sanitize_violation
# ---------------------------------------------------------------------------


def _llm_violation(suggestion: str) -> Violation:
    return Violation(
        standard_id="VOC-01",
        rule="Use plain language",
        issue="The phrase is unclear",
        suggestion=suggestion,
        source="llm",
    )


def _preprocess_violation(suggestion: str) -> Violation:
    return Violation(
        standard_id="PRF-04",
        rule="No trailing periods on headings",
        issue="trailing period on a label",
        suggestion=suggestion,
        source="deterministic",
    )


class TestSanitizeViolation:
    def test_replaces_slop_with_fallback(self):
        v = _llm_violation("Our support team can help — contact us today!")
        replaced = sanitize_violation(
            v,
            original_text="Click here",
            audience=Audience.PRODUCT_UI,
        )
        assert replaced
        assert "Something's not right" in v.suggestion

    def test_skips_clean_suggestions(self):
        v = _llm_violation("View pricing")
        replaced = sanitize_violation(
            v,
            original_text="Click here",
            audience=Audience.PRODUCT_UI,
        )
        assert not replaced
        assert v.suggestion == "View pricing"

    def test_skips_preprocessor_violations(self):
        # Preprocessor suggestions are hand-tuned. Even if they happen
        # to contain a banned phrase, we don't second-guess them.
        v = _preprocess_violation("Don't worry, just remove the period.")
        replaced = sanitize_violation(
            v,
            original_text="Headline.",
            audience=Audience.PRODUCT_UI,
        )
        assert not replaced
        assert v.suggestion == "Don't worry, just remove the period."

    def test_general_audience_leaves_slop_alone(self):
        # GENERAL fallback is empty → don't replace, even if slop.
        original_suggestion = "Our support team can help with this."
        v = _llm_violation(original_suggestion)
        replaced = sanitize_violation(
            v,
            original_text="Marketing headline",
            audience=Audience.GENERAL,
        )
        assert not replaced
        assert v.suggestion == original_suggestion


class TestSanitizeViolations:
    def test_returns_count_and_mutates_in_place(self):
        violations = [
            _llm_violation("Our support team can help."),  # slop
            _llm_violation("View pricing"),  # clean
            _llm_violation("Please feel free to reach out."),  # slop
            _preprocess_violation("Our support team can help."),  # skipped
        ]
        replaced = sanitize_violations(
            violations,
            original_text="Click here",
            audience=Audience.PRODUCT_UI,
        )
        assert replaced == 2
        # First and third got the fallback; second and fourth untouched.
        assert "Something's not right" in violations[0].suggestion
        assert violations[1].suggestion == "View pricing"
        assert "Something's not right" in violations[2].suggestion
        assert violations[3].suggestion == "Our support team can help."

    def test_zero_replacements(self):
        violations = [
            _llm_violation("View pricing"),
            _llm_violation("Save changes"),
        ]
        assert sanitize_violations(
            violations,
            original_text="Click here",
            audience=Audience.PRODUCT_UI,
        ) == 0

    def test_empty_list(self):
        assert sanitize_violations(
            [],
            original_text="x",
            audience=Audience.PRODUCT_UI,
        ) == 0
