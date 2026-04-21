"""Tests for Apple eval moment patches (v4.4.1).

Moment patches:
    moments.py: PRF-11 weights, e-commerce patterns, pipeline functions

Preprocessor patches (PRF-11 effortlessly, PRF-04 inch marks, GRM-05
pronoun-one, preprocess integration) moved to test_preprocess.py
during M2 consolidation.

Run: python3 -m pytest tests/test_apple_patches.py -v
"""

import pytest
from content_checker.moments import (
    detect_moment,
    get_moment_weights,
    get_moment_weights_applied,
    is_standard_suppressed_by_moment,
    get_suppressed_standards_for_moment,
    MOMENT_WEIGHTS,
)


# ===================================================================
# Moment detection: e-commerce patterns
# ===================================================================

class TestMomentEcommerceDetection:
    """E-commerce decision patterns added from Apple eval.

    Apple product pages have trade-in offers, financing terms, and
    education pricing that should detect as 'decision_point'.
    """

    def test_trade_in(self):
        assert detect_moment("Trade in your old device", "short_ui_copy") == "decision_point"

    def test_trade_in_hyphenated(self):
        assert detect_moment("Get a trade-in estimate", "short_ui_copy") == "decision_point"

    def test_interest_free(self):
        assert detect_moment("Pay interest-free for 24 months", "short_ui_copy") == "decision_point"

    def test_save_up_to(self):
        assert detect_moment("Save up to $200 with trade-in", "short_ui_copy") == "decision_point"

    def test_monthly_installments(self):
        assert detect_moment("Pay in monthly installments", "short_ui_copy") == "decision_point"

    def test_education_pricing(self):
        assert detect_moment("Education pricing available", "short_ui_copy") == "decision_point"

    def test_financing(self):
        assert detect_moment("Financing options available", "short_ui_copy") == "decision_point"

    def test_credit_toward(self):
        assert detect_moment("Get credit toward a new device", "short_ui_copy") == "decision_point"

    def test_existing_pricing_still_works(self):
        """Regression: existing pattern still detected."""
        assert detect_moment("Compare plans", "short_ui_copy") == "decision_point"

    def test_existing_free_trial_still_works(self):
        assert detect_moment("Start your free trial", "short_ui_copy") == "decision_point"


# ===================================================================
# Moment weights: PRF-11 across moments
# ===================================================================

class TestMomentPrf11Weights:
    """PRF-11 (dismissive language) weight assignments across moments.

    Suppress in browsing/decision (marketing value props are legitimate).
    Emphasize in error/task/onboarding (dismissive language is harmful).
    """

    def test_prf11_suppressed_in_browsing(self):
        assert is_standard_suppressed_by_moment("PRF-11", "browsing_discovery")

    def test_prf11_suppressed_in_decision(self):
        assert is_standard_suppressed_by_moment("PRF-11", "decision_point")

    def test_prf11_not_suppressed_in_error(self):
        assert not is_standard_suppressed_by_moment("PRF-11", "error_recovery")

    def test_prf11_not_suppressed_in_task(self):
        assert not is_standard_suppressed_by_moment("PRF-11", "task_execution")

    def test_prf11_not_suppressed_in_first_encounter(self):
        assert not is_standard_suppressed_by_moment("PRF-11", "first_encounter")

    def test_prf11_emphasized_in_error(self):
        weights = get_moment_weights("error_recovery")
        prf11 = [w for w in weights if w.standard_id == "PRF-11"]
        assert len(prf11) == 1
        assert prf11[0].modifier == "emphasize"

    def test_prf11_emphasized_in_task(self):
        weights = get_moment_weights("task_execution")
        prf11 = [w for w in weights if w.standard_id == "PRF-11"]
        assert len(prf11) == 1
        assert prf11[0].modifier == "emphasize"

    def test_prf11_emphasized_in_first_encounter(self):
        weights = get_moment_weights("first_encounter")
        prf11 = [w for w in weights if w.standard_id == "PRF-11"]
        assert len(prf11) == 1
        assert prf11[0].modifier == "emphasize"


# ===================================================================
# Pipeline-facing moment functions
# ===================================================================

class TestMomentPipelineFunctions:
    """The three functions that pipeline.py depends on."""

    def test_get_moment_weights_applied_returns_strings(self):
        result = get_moment_weights_applied("error_recovery")
        assert isinstance(result, list)
        assert all(isinstance(s, str) for s in result)
        assert any("VT-05" in s for s in result)

    def test_get_moment_weights_applied_format(self):
        result = get_moment_weights_applied("error_recovery")
        for entry in result:
            assert "(" in entry and entry.endswith(")")

    def test_get_moment_weights_applied_default_empty(self):
        """Unknown moments return empty list."""
        result = get_moment_weights_applied("nonexistent_moment")
        assert result == []

    def test_get_suppressed_standards_returns_frozenset(self):
        result = get_suppressed_standards_for_moment("error_recovery")
        assert isinstance(result, frozenset)

    def test_get_suppressed_standards_error_recovery(self):
        result = get_suppressed_standards_for_moment("error_recovery")
        assert "GRM-03" in result

    def test_get_suppressed_standards_browsing(self):
        result = get_suppressed_standards_for_moment("browsing_discovery")
        assert "PRF-11" in result

    def test_get_suppressed_standards_default_empty(self):
        result = get_suppressed_standards_for_moment("nonexistent_moment")
        assert len(result) == 0

    def test_is_suppressed_true(self):
        assert is_standard_suppressed_by_moment("GRM-03", "error_recovery")

    def test_is_suppressed_false(self):
        assert not is_standard_suppressed_by_moment("CLR-01", "error_recovery")
