"""Tests for moment pipeline integration.

Covers all three phases:
    Phase 1: Moment detection and recording (no verdict changes)
    Phase 2: Moment-aware merge (deterministic verdict changes via suppression)
    Phase 3: Moment prompt injection (LLM sees moment context)

Test organization:
    TestMomentDetectionHeuristic  — Tier 1 heuristic correctness
    TestMomentWeights             — Weight definitions and lookup functions
    TestMomentSuppression         — Phase 2 merge-stage suppression logic
    TestMomentPromptSection       — Phase 3 system prompt construction
    TestMomentEcommerce           — E-commerce decision patterns (from Apple eval)
    TestPRF11MomentGating         — PRF-11 dismissive language, gated by moment
    TestMomentPipelineIntegration — End-to-end pipeline behavior
"""

import pytest

from content_checker.moments import (
    DEFAULT_MOMENT,
    MOMENT_CONFIDENCE_FALLBACK,
    MOMENT_CONFIDENCE_MATCHED,
    MOMENT_CONFIDENCE_THRESHOLD,
    MOMENT_TAXONOMY,
    MOMENT_WEIGHTS,
    VALID_MOMENTS,
    MomentWeight,
    build_moment_prompt_section,
    detect_moment,
    detect_moment_with_confidence,
    get_moment_weights,
    get_moment_weights_applied,
    get_suppressed_standards_for_moment,
    is_standard_suppressed_by_moment,
)


class TestMomentConfidenceSignal:
    """Human-eval build plan Session 2 — moment confidence signal."""

    def test_matched_pattern_gives_high_confidence(self):
        moment, conf = detect_moment_with_confidence(
            "Are you sure you want to delete this?", "short_ui_copy",
        )
        assert moment == "destructive_action"
        assert conf == MOMENT_CONFIDENCE_MATCHED
        assert conf >= MOMENT_CONFIDENCE_THRESHOLD

    def test_content_type_match_gives_high_confidence(self):
        moment, conf = detect_moment_with_confidence(
            "Something happened that I can't identify", "error_message",
        )
        assert moment == "error_recovery"
        assert conf == MOMENT_CONFIDENCE_MATCHED

    def test_fallback_to_default_gives_low_confidence(self):
        moment, conf = detect_moment_with_confidence(
            "Hello there friend of mine", "short_ui_copy",
        )
        assert moment == DEFAULT_MOMENT
        assert conf == MOMENT_CONFIDENCE_FALLBACK
        assert conf < MOMENT_CONFIDENCE_THRESHOLD

    def test_detect_moment_wrapper_still_returns_string(self):
        """Session 1 callers that only want the moment string keep working."""
        assert detect_moment("Delete this?", "button_cta") == "destructive_action"
        assert isinstance(detect_moment("hi", "short_ui_copy"), str)

    def test_threshold_constant_matches_spec(self):
        # Human-eval build plan Session 2 spec: < 0.6 fires situation_ambiguity.
        assert MOMENT_CONFIDENCE_THRESHOLD == 0.6


# ═══════════════════════════════════════════════════════════════════════
# Phase 1: Moment detection heuristic
# ═══════════════════════════════════════════════════════════════════════


class TestMomentDetectionHeuristic:
    """Tests for the Tier 1 text-pattern heuristic detector."""

    # --- Destructive action (highest priority) ---

    def test_destructive_permanently_delete(self):
        assert detect_moment("Permanently delete this file?", "short_ui_copy") == "destructive_action"

    def test_destructive_cannot_be_undone(self):
        assert detect_moment("This action cannot be undone.", "short_ui_copy") == "destructive_action"

    def test_destructive_button_delete(self):
        assert detect_moment("Delete", "button_cta") == "destructive_action"

    def test_destructive_button_cancel_subscription(self):
        assert detect_moment("Cancel subscription", "button_cta") == "destructive_action"

    def test_destructive_are_you_sure(self):
        assert detect_moment("Are you sure you want to delete this project?", "short_ui_copy") == "destructive_action"

    # --- Error recovery ---

    def test_error_content_type(self):
        assert detect_moment("Invalid email address.", "error_message") == "error_recovery"

    def test_error_went_wrong(self):
        assert detect_moment("Something went wrong. Please try again.", "short_ui_copy") == "error_recovery"

    def test_error_couldnt(self):
        assert detect_moment("We couldn't save your changes.", "short_ui_copy") == "error_recovery"

    def test_error_not_found(self):
        assert detect_moment("Page not found.", "short_ui_copy") == "error_recovery"

    # --- Confirmation ---

    def test_confirmation_content_type(self):
        assert detect_moment("Payment received.", "confirmation") == "confirmation"

    def test_confirmation_successfully(self):
        assert detect_moment("Your account has been successfully created.", "short_ui_copy") == "confirmation"

    def test_confirmation_changes_saved(self):
        assert detect_moment("Changes saved.", "short_ui_copy") == "confirmation"

    def test_confirmation_youre_all_set(self):
        assert detect_moment("You're all set!", "short_ui_copy") == "confirmation"

    # --- Empty state ---

    def test_empty_no_items_yet(self):
        assert detect_moment("No projects yet.", "short_ui_copy") == "empty_state"

    def test_empty_nothing_here(self):
        assert detect_moment("Nothing here. Get started by creating a project.", "short_ui_copy") == "empty_state"

    def test_empty_no_results(self):
        assert detect_moment("No results found.", "short_ui_copy") == "empty_state"

    def test_empty_you_havent(self):
        assert detect_moment("You haven't added any team members.", "short_ui_copy") == "empty_state"

    # --- First encounter ---

    def test_first_encounter_welcome(self):
        assert detect_moment("Welcome to your dashboard.", "short_ui_copy") == "first_encounter"

    def test_first_encounter_getting_started(self):
        assert detect_moment("Getting started with your new workspace.", "short_ui_copy") == "first_encounter"

    def test_first_encounter_step_of(self):
        assert detect_moment("Step 1 of 3: Choose your plan.", "short_ui_copy") == "first_encounter"

    def test_first_encounter_set_up_your(self):
        assert detect_moment("Set up your profile to get started.", "short_ui_copy") == "first_encounter"

    # --- Decision point ---

    def test_decision_compare_plans(self):
        assert detect_moment("Compare plans and pricing.", "short_ui_copy") == "decision_point"

    def test_decision_free_trial(self):
        assert detect_moment("Start your 14-day free trial.", "short_ui_copy") == "decision_point"

    def test_decision_per_month(self):
        assert detect_moment("$29 per month, billed annually.", "short_ui_copy") == "decision_point"

    def test_decision_upgrade(self):
        assert detect_moment("Upgrade to Pro for unlimited access.", "short_ui_copy") == "decision_point"

    # --- Decision point: e-commerce patterns (from Apple eval) ---

    def test_decision_trade_in(self):
        assert detect_moment("Trade in your current device. Get credit toward a new one.", "short_ui_copy") == "decision_point"

    def test_decision_save_up_to(self):
        assert detect_moment("Save up to $670 with Apple Trade In.", "short_ui_copy") == "decision_point"

    def test_decision_pay_over_time(self):
        assert detect_moment("Pay over time, interest-free.", "short_ui_copy") == "decision_point"

    def test_decision_education_pricing(self):
        assert detect_moment("Save on a new iPad with education pricing.", "short_ui_copy") == "decision_point"

    def test_decision_monthly_installments(self):
        assert detect_moment("Pay with Apple Card Monthly Installments.", "short_ui_copy") == "decision_point"

    def test_decision_financing(self):
        assert detect_moment("Financing options available for all products.", "short_ui_copy") == "decision_point"

    def test_decision_credit_toward(self):
        assert detect_moment("Get credit toward your next purchase.", "short_ui_copy") == "decision_point"

    # --- Interruption ---

    def test_interruption_dismiss(self):
        assert detect_moment("Dismiss", "button_cta") == "interruption"

    def test_interruption_not_now(self):
        assert detect_moment("Not now", "button_cta") == "interruption"

    def test_interruption_dont_show_again(self):
        assert detect_moment("Don't show this again", "short_ui_copy") == "interruption"

    # --- Wayfinding ---

    def test_wayfinding_short_label(self):
        assert detect_moment("Settings", "ui_label") == "wayfinding"

    def test_wayfinding_two_word_label(self):
        assert detect_moment("Account settings", "ui_label") == "wayfinding"

    def test_wayfinding_heading(self):
        assert detect_moment("Billing", "heading") == "wayfinding"

    # --- Task execution ---

    def test_task_enter_your(self):
        assert detect_moment("Enter your email address.", "short_ui_copy") == "task_execution"

    def test_task_fill_out(self):
        assert detect_moment("Fill out the form below.", "short_ui_copy") == "task_execution"

    def test_task_tooltip(self):
        assert detect_moment("Choose a file to upload.", "tooltip_microcopy") == "task_execution"

    # --- Default fallback ---

    def test_default_generic_copy(self):
        assert detect_moment("Our platform helps teams collaborate.", "short_ui_copy") == DEFAULT_MOMENT

    def test_default_long_label(self):
        """Labels longer than 4 words should not auto-match wayfinding."""
        assert detect_moment("Your recently viewed items and history", "ui_label") == DEFAULT_MOMENT


# ═══════════════════════════════════════════════════════════════════════
# Phase 1: Moment weight definitions
# ═══════════════════════════════════════════════════════════════════════


class TestMomentWeights:
    """Tests for weight definitions and lookup functions."""

    def test_all_moments_have_weight_entries(self):
        """Every canonical moment should have an entry in MOMENT_WEIGHTS."""
        for moment in VALID_MOMENTS:
            assert moment in MOMENT_WEIGHTS, f"Missing MOMENT_WEIGHTS entry for {moment}"

    def test_weight_modifiers_are_valid(self):
        """Every weight modifier must be emphasize, relax, or suppress."""
        valid_modifiers = {"emphasize", "relax", "suppress"}
        for moment, weights in MOMENT_WEIGHTS.items():
            for w in weights:
                assert w.modifier in valid_modifiers, (
                    f"Invalid modifier '{w.modifier}' for {w.standard_id} in {moment}"
                )

    def test_browsing_discovery_has_prf11_suppress(self):
        """browsing_discovery should suppress PRF-11 (added for moment gating)."""
        weights = get_moment_weights("browsing_discovery")
        prf11 = [w for w in weights if w.standard_id == "PRF-11"]
        assert len(prf11) == 1
        assert prf11[0].modifier == "suppress"

    def test_decision_point_has_prf11_suppress(self):
        """decision_point should suppress PRF-11."""
        weights = get_moment_weights("decision_point")
        prf11 = [w for w in weights if w.standard_id == "PRF-11"]
        assert len(prf11) == 1
        assert prf11[0].modifier == "suppress"

    def test_error_recovery_has_prf11_emphasize(self):
        """error_recovery should emphasize PRF-11."""
        weights = get_moment_weights("error_recovery")
        prf11 = [w for w in weights if w.standard_id == "PRF-11"]
        assert len(prf11) == 1
        assert prf11[0].modifier == "emphasize"

    def test_task_execution_has_prf11_emphasize(self):
        """task_execution should emphasize PRF-11."""
        weights = get_moment_weights("task_execution")
        prf11 = [w for w in weights if w.standard_id == "PRF-11"]
        assert len(prf11) == 1
        assert prf11[0].modifier == "emphasize"

    def test_first_encounter_has_prf11_emphasize(self):
        """first_encounter should emphasize PRF-11."""
        weights = get_moment_weights("first_encounter")
        prf11 = [w for w in weights if w.standard_id == "PRF-11"]
        assert len(prf11) == 1
        assert prf11[0].modifier == "emphasize"

    def test_unknown_moment_returns_empty(self):
        assert get_moment_weights("nonexistent") == []

    def test_get_moment_weights_applied_format(self):
        """Applied weights should format as 'ID(modifier)' strings."""
        applied = get_moment_weights_applied("error_recovery")
        assert all("(" in w and ")" in w for w in applied)
        assert any("VT-05(emphasize)" in w for w in applied)

    def test_get_moment_weights_applied_empty_for_default(self):
        """Default moment (browsing_discovery) should still have PRF-11."""
        applied = get_moment_weights_applied("browsing_discovery")
        assert any("PRF-11" in w for w in applied)


# ═══════════════════════════════════════════════════════════════════════
# Phase 2: Moment-aware merge suppression
# ═══════════════════════════════════════════════════════════════════════


class TestMomentSuppression:
    """Tests for is_standard_suppressed_by_moment() — the merge-stage gate."""

    # --- PRF-11 suppression by moment ---

    def test_prf11_suppressed_in_browsing_discovery(self):
        assert is_standard_suppressed_by_moment("PRF-11", "browsing_discovery") is True

    def test_prf11_suppressed_in_decision_point(self):
        assert is_standard_suppressed_by_moment("PRF-11", "decision_point") is True

    def test_prf11_not_suppressed_in_error_recovery(self):
        assert is_standard_suppressed_by_moment("PRF-11", "error_recovery") is False

    def test_prf11_not_suppressed_in_task_execution(self):
        assert is_standard_suppressed_by_moment("PRF-11", "task_execution") is False

    def test_prf11_not_suppressed_in_first_encounter(self):
        assert is_standard_suppressed_by_moment("PRF-11", "first_encounter") is False

    def test_prf11_not_suppressed_in_confirmation(self):
        """Confirmation has no PRF-11 weight — should not suppress."""
        assert is_standard_suppressed_by_moment("PRF-11", "confirmation") is False

    # --- Other suppressions (existing) ---

    def test_act01_suppressed_in_wayfinding(self):
        assert is_standard_suppressed_by_moment("ACT-01", "wayfinding") is True

    def test_clr03_suppressed_in_wayfinding(self):
        assert is_standard_suppressed_by_moment("CLR-03", "wayfinding") is True

    def test_grm03_suppressed_in_error_recovery(self):
        assert is_standard_suppressed_by_moment("GRM-03", "error_recovery") is True

    # --- Non-suppressed standards ---

    def test_clr01_not_suppressed_anywhere(self):
        """CLR-01 is emphasized in several moments but never suppressed."""
        for moment in VALID_MOMENTS:
            assert is_standard_suppressed_by_moment("CLR-01", moment) is False

    def test_relax_is_not_suppression(self):
        """'relax' modifier should NOT cause suppression — only 'suppress' does."""
        # VT-01 is relaxed in confirmation, not suppressed
        assert is_standard_suppressed_by_moment("VT-01", "confirmation") is False

    def test_emphasize_is_not_suppression(self):
        """'emphasize' modifier should NOT cause suppression."""
        # CLR-01 is emphasized in error_recovery
        assert is_standard_suppressed_by_moment("CLR-01", "error_recovery") is False

    def test_unknown_moment_never_suppresses(self):
        assert is_standard_suppressed_by_moment("PRF-11", "nonexistent_moment") is False

    def test_unknown_standard_never_suppressed(self):
        assert is_standard_suppressed_by_moment("FAKE-99", "browsing_discovery") is False

    # --- get_suppressed_standards_for_moment ---

    def test_suppressed_set_for_wayfinding(self):
        suppressed = get_suppressed_standards_for_moment("wayfinding")
        assert "ACT-01" in suppressed
        assert "CLR-03" in suppressed
        assert "CON-02" not in suppressed  # CON-02 is emphasized, not suppressed

    def test_suppressed_set_for_browsing(self):
        suppressed = get_suppressed_standards_for_moment("browsing_discovery")
        assert "PRF-11" in suppressed

    def test_suppressed_set_for_decision(self):
        suppressed = get_suppressed_standards_for_moment("decision_point")
        assert "PRF-11" in suppressed

    def test_suppressed_set_empty_for_confirmation(self):
        """Confirmation has relaxations but no suppressions."""
        suppressed = get_suppressed_standards_for_moment("confirmation")
        assert len(suppressed) == 0


# ═══════════════════════════════════════════════════════════════════════
# Phase 3: System prompt construction
# ═══════════════════════════════════════════════════════════════════════


class TestMomentPromptSection:
    """Tests for build_moment_prompt_section() — the LLM prompt injection."""

    def test_default_moment_returns_empty(self):
        """browsing_discovery is the default — but it now has weights (PRF-11)."""
        # browsing_discovery IS the DEFAULT_MOMENT, so it returns empty string
        # even though it has weights. This is by design: the default moment
        # doesn't inject a prompt section because it's the baseline.
        section = build_moment_prompt_section(DEFAULT_MOMENT)
        assert section == ""

    def test_error_recovery_has_content(self):
        section = build_moment_prompt_section("error_recovery")
        assert "error recovery" in section.lower()
        assert "VT-05" in section
        assert "Pay extra attention" in section

    def test_wayfinding_has_suppress_lines(self):
        section = build_moment_prompt_section("wayfinding")
        assert "ACT-01" in section
        assert "Rarely applies here" in section

    def test_destructive_action_has_relax_lines(self):
        section = build_moment_prompt_section("destructive_action")
        assert "STR-02" in section
        assert "Minor deviations acceptable" in section

    def test_unknown_moment_returns_empty(self):
        section = build_moment_prompt_section("not_a_real_moment")
        assert section == ""

    def test_decision_point_includes_prf11(self):
        section = build_moment_prompt_section("decision_point")
        assert "PRF-11" in section

    def test_first_encounter_includes_prf11_emphasize(self):
        section = build_moment_prompt_section("first_encounter")
        assert "PRF-11" in section
        assert "Pay extra attention" in section


# ═══════════════════════════════════════════════════════════════════════
# Phase 2: PRF-11 moment gating (the forcing function for this feature)
# ═══════════════════════════════════════════════════════════════════════


class TestPRF11MomentGating:
    """PRF-11 dismissive language, gated by moment rather than audience.

    Validates that the preprocessor fires on 'simply', 'easily', 'just + verb',
    and 'easy/simple + noun' regardless of moment — and the merge stage
    suppresses the violation when the moment is browsing_discovery or
    decision_point.

    This tests the architectural principle: the preprocessor stays
    moment-unaware, and the merge stage handles all suppression policy.
    """

    def test_preprocessor_fires_on_simply(self):
        """PRF-11 preprocessor check fires regardless of moment."""
        from content_checker.preprocess import preprocess, Outcome

        results = preprocess("Simply click the button to continue.", "short_ui_copy")
        prf11 = [r for r in results if r.standard_id == "PRF-11"]
        assert len(prf11) == 1
        assert prf11[0].outcome == Outcome.VIOLATION

    def test_preprocessor_fires_on_easy_setup(self):
        from content_checker.preprocess import preprocess, Outcome

        results = preprocess("Easy setup in 3 steps.", "short_ui_copy")
        prf11 = [r for r in results if r.standard_id == "PRF-11"]
        assert len(prf11) == 1
        assert prf11[0].outcome == Outcome.VIOLATION

    def test_preprocessor_fires_on_effortlessly(self):
        from content_checker.preprocess import preprocess, Outcome

        results = preprocess("Manage your finances effortlessly.", "short_ui_copy")
        prf11 = [r for r in results if r.standard_id == "PRF-11"]
        assert len(prf11) == 1
        assert prf11[0].outcome == Outcome.VIOLATION

    def test_simply_suppressed_in_browsing(self):
        """'Simply' on a marketing page (browsing) → suppressed by moment."""
        assert is_standard_suppressed_by_moment("PRF-11", "browsing_discovery") is True

    def test_simply_not_suppressed_in_task(self):
        """'Simply' in a form flow (task execution) → NOT suppressed."""
        assert is_standard_suppressed_by_moment("PRF-11", "task_execution") is False

    def test_simply_not_suppressed_in_error(self):
        """'Simply try again' in an error state → NOT suppressed."""
        assert is_standard_suppressed_by_moment("PRF-11", "error_recovery") is False

    def test_easy_suppressed_in_decision(self):
        """'Easy setup' on a pricing page (decision) → suppressed."""
        assert is_standard_suppressed_by_moment("PRF-11", "decision_point") is True


# ═══════════════════════════════════════════════════════════════════════
# E-commerce decision detection (from Apple eval)
# ═══════════════════════════════════════════════════════════════════════


class TestMomentEcommerce:
    """E-commerce decision-point patterns added from Apple eval calibration.

    The original heuristic only detected SaaS pricing patterns (compare plans,
    per month, free trial). These tests verify the expanded patterns for
    retail/e-commerce decision moments.
    """

    def test_trade_in_hyphenated(self):
        assert detect_moment("Trade-in your old device for credit.", "short_ui_copy") == "decision_point"

    def test_trade_in_spaced(self):
        assert detect_moment("Apple Trade In values.", "short_ui_copy") == "decision_point"

    def test_interest_free_hyphenated(self):
        assert detect_moment("Buy now, interest-free.", "short_ui_copy") == "decision_point"

    def test_interest_free_spaced(self):
        assert detect_moment("Pay with interest free financing.", "short_ui_copy") == "decision_point"

    def test_save_up_to_dollar(self):
        assert detect_moment("Save up to $500 when you switch.", "short_ui_copy") == "decision_point"

    def test_monthly_installments(self):
        assert detect_moment("Pay with monthly installments.", "short_ui_copy") == "decision_point"

    def test_education_pricing(self):
        assert detect_moment("Special education pricing available.", "short_ui_copy") == "decision_point"

    def test_financing(self):
        assert detect_moment("Financing available for qualifying purchases.", "short_ui_copy") == "decision_point"

    def test_credit_toward(self):
        assert detect_moment("Get credit toward a new device.", "short_ui_copy") == "decision_point"

    def test_generic_product_description_not_decision(self):
        """Product descriptions without decision signals stay default."""
        assert detect_moment(
            "The all-new MacBook Air with M4 chip.",
            "short_ui_copy",
        ) == DEFAULT_MOMENT


# ═══════════════════════════════════════════════════════════════════════
# Pipeline integration tests (require models.py patch)
# ═══════════════════════════════════════════════════════════════════════


class TestMomentPipelineIntegration:
    """Tests for moment integration in the pipeline.

    These tests validate the build_system_prompt() function accepts and
    uses the moment parameter. They do NOT make API calls.
    """

    def test_build_system_prompt_accepts_moment(self):
        """build_system_prompt should accept a moment parameter."""
        from content_checker.pipeline import build_system_prompt
        from content_checker.audience import Audience
        from content_checker.standards.loader import load_standards

        standards = load_standards()
        # Should not raise
        prompt = build_system_prompt(
            standards, content_type="short_ui_copy",
            audience=Audience.PRODUCT_UI, moment="error_recovery",
        )
        assert "error recovery" in prompt.lower()

    def test_build_system_prompt_default_moment_no_section(self):
        """Default moment should not add a moment section to the prompt."""
        from content_checker.pipeline import build_system_prompt
        from content_checker.audience import Audience
        from content_checker.standards.loader import load_standards

        standards = load_standards()
        prompt = build_system_prompt(
            standards, content_type="short_ui_copy",
            audience=Audience.PRODUCT_UI, moment=DEFAULT_MOMENT,
        )
        assert "Moment context" not in prompt

    def test_build_system_prompt_empty_moment_no_section(self):
        """Empty string moment should not add a moment section."""
        from content_checker.pipeline import build_system_prompt
        from content_checker.audience import Audience
        from content_checker.standards.loader import load_standards

        standards = load_standards()
        prompt = build_system_prompt(
            standards, content_type="short_ui_copy",
            audience=Audience.PRODUCT_UI, moment="",
        )
        assert "Moment context" not in prompt

    def test_build_system_prompt_no_moment_backwards_compatible(self):
        """Calling without moment parameter should work (default='')."""
        from content_checker.pipeline import build_system_prompt
        from content_checker.audience import Audience
        from content_checker.standards.loader import load_standards

        standards = load_standards()
        # This tests the default parameter value
        prompt = build_system_prompt(
            standards, content_type="short_ui_copy",
            audience=Audience.PRODUCT_UI,
        )
        assert "Moment context" not in prompt

    def test_wayfinding_prompt_includes_suppress_instructions(self):
        """Wayfinding moment should tell the LLM to suppress ACT-01."""
        from content_checker.pipeline import build_system_prompt
        from content_checker.audience import Audience
        from content_checker.standards.loader import load_standards

        standards = load_standards()
        prompt = build_system_prompt(
            standards, content_type="ui_label",
            audience=Audience.PRODUCT_UI, moment="wayfinding",
        )
        assert "ACT-01" in prompt
        assert "Rarely applies here" in prompt


# ═══════════════════════════════════════════════════════════════════════
# Taxonomy integrity checks
# ═══════════════════════════════════════════════════════════════════════


class TestMomentTaxonomyIntegrity:
    """Structural integrity tests for the moment system."""

    def test_ten_canonical_moments(self):
        assert len(MOMENT_TAXONOMY) == 13

    def test_valid_moments_matches_taxonomy(self):
        assert VALID_MOMENTS == frozenset(MOMENT_TAXONOMY.keys())

    def test_default_moment_in_taxonomy(self):
        assert DEFAULT_MOMENT in MOMENT_TAXONOMY

    def test_all_weight_standards_exist_in_library(self):
        """Every standard ID referenced in weights should exist in the library."""
        from content_checker.standards.loader import load_standards
        standards_data = load_standards()

        all_standard_ids = set()
        for cat in standards_data["categories"]:
            for std in cat["standards"]:
                all_standard_ids.add(std["id"])

        # Also include preprocessor-only standards
        all_standard_ids.update({
            "PRF-01", "PRF-02", "PRF-03", "PRF-04", "PRF-05",
            "PRF-06", "PRF-07", "PRF-08", "PRF-09", "PRF-10", "PRF-11",
        })

        for moment, weights in MOMENT_WEIGHTS.items():
            for w in weights:
                assert w.standard_id in all_standard_ids, (
                    f"Weight references unknown standard {w.standard_id} in {moment}"
                )

    def test_no_duplicate_standards_per_moment(self):
        """Each standard should appear at most once per moment."""
        for moment, weights in MOMENT_WEIGHTS.items():
            ids = [w.standard_id for w in weights]
            assert len(ids) == len(set(ids)), (
                f"Duplicate standard in {moment}: {ids}"
            )

    def test_detect_moment_always_returns_valid(self):
        """detect_moment should never return a string not in VALID_MOMENTS."""
        test_texts = [
            ("", "short_ui_copy"),
            ("Hello world", "button_cta"),
            ("x", "ui_label"),
            ("A" * 500, "long_form_copy"),
        ]
        for text, ct in test_texts:
            result = detect_moment(text, ct)
            assert result in VALID_MOMENTS, (
                f"detect_moment returned '{result}' for text='{text[:30]}', ct='{ct}'"
            )


class TestPromptCachingBlocks:
    """Tests for build_system_prompt_blocks (audit C-12 prompt caching)."""

    def test_returns_three_blocks(self):
        from content_checker.pipeline import build_system_prompt_blocks
        from content_checker.audience import Audience
        from content_checker.standards.loader import load_standards

        blocks = build_system_prompt_blocks(
            load_standards(), content_type="short_ui_copy",
            audience=Audience.PRODUCT_UI, moment="error_recovery",
        )
        assert isinstance(blocks, list)
        assert len(blocks) == 3
        for block in blocks:
            assert block["type"] == "text"
            assert isinstance(block["text"], str)

    def test_only_standards_block_is_cached(self):
        """The middle (standards) block carries cache_control; intro and
        tail blocks do NOT (they contain dynamic content_type/audience/
        moment that varies per request)."""
        from content_checker.pipeline import build_system_prompt_blocks
        from content_checker.audience import Audience
        from content_checker.standards.loader import load_standards

        blocks = build_system_prompt_blocks(
            load_standards(), content_type="short_ui_copy",
            audience=Audience.PRODUCT_UI, moment="error_recovery",
        )
        assert "cache_control" not in blocks[0]
        assert blocks[1]["cache_control"] == {"type": "ephemeral"}
        assert "cache_control" not in blocks[2]

    def test_standards_block_contains_standards_content(self):
        """The cached block should be the standards library (the largest
        static portion). Verify by checking for standard ID patterns."""
        from content_checker.pipeline import build_system_prompt_blocks
        from content_checker.audience import Audience
        from content_checker.standards.loader import load_standards

        blocks = build_system_prompt_blocks(
            load_standards(), content_type="short_ui_copy",
            audience=Audience.PRODUCT_UI, moment="",
        )
        standards_text = blocks[1]["text"]
        # ACT-01 is one of the engine's earliest standard IDs; should be
        # present in any non-empty standards library.
        assert "ACT-01" in standards_text or "###" in standards_text
        # The standards portion should be the largest by far — a sanity
        # check that we put the right content in the cached block.
        assert len(standards_text) > len(blocks[0]["text"])
        assert len(standards_text) > len(blocks[2]["text"])

    def test_dynamic_context_in_uncached_blocks(self):
        """content_type/audience belong in the uncached intro block;
        moment belongs in the uncached tail block. Verifying these
        don't accidentally land in the cached standards block."""
        from content_checker.pipeline import build_system_prompt_blocks
        from content_checker.audience import Audience
        from content_checker.standards.loader import load_standards

        blocks = build_system_prompt_blocks(
            load_standards(), content_type="error_message",
            audience=Audience.PRODUCT_UI, moment="error_recovery",
        )
        # content_type appears in the intro (uncached)
        assert "error_message" in blocks[0]["text"]
        # moment appears in the tail (uncached)
        assert "error recovery" in blocks[2]["text"].lower() or "Moment context" in blocks[2]["text"]
        # Standards block (cached) should NOT contain per-request strings
        # like the specific moment name — those vary across requests and
        # would break the cache key if mixed in.
        assert "error_message" not in blocks[1]["text"]

    def test_string_version_still_works_for_backward_compat(self):
        """build_system_prompt (string) must still return a string with
        all sections concatenated — existing tests + any external callers
        depend on the str return type."""
        from content_checker.pipeline import build_system_prompt
        from content_checker.audience import Audience
        from content_checker.standards.loader import load_standards

        prompt = build_system_prompt(
            load_standards(), content_type="short_ui_copy",
            audience=Audience.PRODUCT_UI, moment="error_recovery",
        )
        assert isinstance(prompt, str)
        # The string version concatenates all three sections, so it
        # should contain content from each.
        assert "content standards checker" in prompt.lower()  # intro
        assert "###" in prompt or "ACT-" in prompt  # standards
        assert "How to evaluate" in prompt  # tail
