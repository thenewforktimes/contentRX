"""Tests for v4.4.2 moment patches.

Patch inventory:
    moments.py: Celebration moment (detection + weights)
    moments.py: Trust/permission moment (detection + weights)
    moments.py: VT-03, ACT-03, ACT-04 weight additions to existing moments

Preprocessor patches (GRM-05 unicode hyphens, GRM-05 safe context
additions) moved to test_preprocess.py during M2 consolidation.

Run: python3 -m pytest tests/test_v442_patches.py -v
"""

import pytest
from content_checker.moments import (
    detect_moment,
    get_moment_weights,
    get_moment_weights_applied,
    is_standard_suppressed_by_moment,
    get_suppressed_standards_for_moment,
    MOMENT_TAXONOMY,
    MOMENT_WEIGHTS,
    VALID_MOMENTS,
)


# ===================================================================
# Celebration moment: detection
# ===================================================================

class TestCelebrationDetection:
    """Celebration has specific signals that don't overlap with
    generic confirmation ('saved', 'created', 'all done').
    """

    def test_congrats(self):
        assert detect_moment("Congrats! You did it!", "short_ui_copy") == "celebration"

    def test_congratulations(self):
        assert detect_moment("Congratulations on your first sale", "short_ui_copy") == "celebration"

    def test_great_job(self):
        assert detect_moment("Great job completing your profile!", "confirmation") == "celebration"

    def test_well_done(self):
        assert detect_moment("Well done! 5 tasks completed.", "short_ui_copy") == "celebration"

    def test_way_to_go(self):
        assert detect_moment("Way to go! You're on a roll.", "short_ui_copy") == "celebration"

    def test_nice_work(self):
        assert detect_moment("Nice work finishing the tutorial", "short_ui_copy") == "celebration"

    def test_streak(self):
        assert detect_moment("7-day streak! Keep it up.", "short_ui_copy") == "celebration"

    def test_milestone(self):
        assert detect_moment("Milestone reached: 100 uploads", "short_ui_copy") == "celebration"

    def test_level_up(self):
        assert detect_moment("You leveled up to Gold status!", "short_ui_copy") == "celebration"

    def test_unlocked(self):
        assert detect_moment("Achievement unlocked: Early Bird", "short_ui_copy") == "celebration"

    def test_badge(self):
        assert detect_moment("You earned a new badge!", "short_ui_copy") == "celebration"

    def test_new_record(self):
        assert detect_moment("New record! Your fastest time yet.", "short_ui_copy") == "celebration"

    def test_on_a_roll(self):
        assert detect_moment("You're on a roll! 3 in a row.", "short_ui_copy") == "celebration"

    def test_completed_count(self):
        assert detect_moment("Completed 50 workouts this year", "short_ui_copy") == "celebration"

    def test_keep_it_up(self):
        assert detect_moment("Keep it up! Almost there.", "short_ui_copy") == "celebration"

    def test_celebration_beats_confirmation(self):
        """Celebration is more specific — 'Congrats' should not fall to confirmation."""
        assert detect_moment("Congratulations! Your account has been created.", "confirmation") == "celebration"

    def test_plain_confirmation_not_celebration(self):
        """Generic confirmations should NOT match celebration."""
        assert detect_moment("Your changes have been saved.", "confirmation") == "confirmation"

    def test_all_done_not_celebration(self):
        """'All done' is confirmation, not celebration."""
        assert detect_moment("All done! Your file is ready.", "short_ui_copy") == "confirmation"


# ===================================================================
# Trust/permission moment: detection
# ===================================================================

class TestTrustPermissionDetection:
    """Trust/permission has consent and verification signals that
    must not be confused with decision_point (pricing/plans).
    """

    def test_allow_access(self):
        assert detect_moment("Allow access to your camera", "short_ui_copy") == "trust_permission"

    def test_grant_access(self):
        assert detect_moment("Grant access to your contacts", "short_ui_copy") == "trust_permission"

    def test_agree_to_terms(self):
        assert detect_moment("Agree to the terms of service", "short_ui_copy") == "trust_permission"

    def test_consent_to(self):
        assert detect_moment("By continuing, you consent to data collection", "long_form_copy") == "trust_permission"

    def test_accept_terms(self):
        assert detect_moment("Accept the terms and conditions", "button_cta") == "trust_permission"

    def test_verify_identity(self):
        assert detect_moment("Verify your identity to continue", "short_ui_copy") == "trust_permission"

    def test_verify_email(self):
        assert detect_moment("Verify your email address", "short_ui_copy") == "trust_permission"

    def test_enable_notifications(self):
        assert detect_moment("Enable notifications to stay updated", "short_ui_copy") == "trust_permission"

    def test_enable_location(self):
        assert detect_moment("Enable location services", "short_ui_copy") == "trust_permission"

    def test_turn_on_notifications(self):
        assert detect_moment("Turn on notifications for this app", "short_ui_copy") == "trust_permission"

    def test_we_use_cookies(self):
        assert detect_moment("We use cookies to improve your experience", "long_form_copy") == "trust_permission"

    def test_we_collect_data(self):
        assert detect_moment("We collect your information to personalize content", "long_form_copy") == "trust_permission"

    def test_privacy_policy(self):
        assert detect_moment("Read our privacy policy", "short_ui_copy") == "trust_permission"

    def test_data_sharing(self):
        assert detect_moment("Learn about our data sharing practices", "short_ui_copy") == "trust_permission"

    def test_app_would_like_to_access(self):
        """Classic iOS permission pattern."""
        assert detect_moment('"Photos" would like to access your camera', "short_ui_copy") == "trust_permission"

    def test_this_site_wants_to(self):
        assert detect_moment("This site wants to send you notifications", "short_ui_copy") == "trust_permission"

    def test_permission_to_access(self):
        assert detect_moment("Grant permission to access your files", "short_ui_copy") == "trust_permission"

    def test_confirm_your_identity(self):
        assert detect_moment("Confirm your identity with Face ID", "short_ui_copy") == "trust_permission"

    def test_trust_beats_decision_point(self):
        """'Allow access' is consent, not a pricing decision."""
        assert detect_moment("Allow access to improve your experience", "short_ui_copy") == "trust_permission"

    def test_pricing_is_still_decision_point(self):
        """Pricing copy should NOT match trust_permission."""
        assert detect_moment("Compare plans and pricing", "short_ui_copy") == "decision_point"

    def test_upgrade_is_still_decision_point(self):
        """Upgrade prompts should NOT match trust_permission."""
        assert detect_moment("Upgrade to Pro for $9.99/mo", "short_ui_copy") == "decision_point"


# ===================================================================
# Taxonomy and structure
# ===================================================================

class TestMomentTaxonomyUpdates:
    """Verify the taxonomy includes the two new moments."""

    def test_celebration_in_taxonomy(self):
        assert "celebration" in MOMENT_TAXONOMY

    def test_trust_permission_in_taxonomy(self):
        assert "trust_permission" in MOMENT_TAXONOMY

    def test_celebration_in_valid_moments(self):
        assert "celebration" in VALID_MOMENTS

    def test_trust_permission_in_valid_moments(self):
        assert "trust_permission" in VALID_MOMENTS

    def test_thirteen_moments_total(self):
        """10 original + celebration + trust_permission + compliance_disclosure = 13."""
        assert len(MOMENT_TAXONOMY) == 13

    def test_all_taxonomy_moments_have_weights(self):
        """Every moment in the taxonomy should have a weights entry."""
        for moment in MOMENT_TAXONOMY:
            assert moment in MOMENT_WEIGHTS, f"{moment} missing from MOMENT_WEIGHTS"


# ===================================================================
# Celebration weights
# ===================================================================

class TestCelebrationWeights:
    """Celebration: GRM-03→relax, PRF-11→suppress, VT-05↑, VT-02↑, VT-03↑."""

    def test_grm03_relaxed(self):
        weights = {w.standard_id: w.modifier for w in get_moment_weights("celebration")}
        assert weights["GRM-03"] == "relax"

    def test_prf11_suppressed(self):
        assert is_standard_suppressed_by_moment("PRF-11", "celebration")

    def test_vt05_emphasized(self):
        weights = {w.standard_id: w.modifier for w in get_moment_weights("celebration")}
        assert weights["VT-05"] == "emphasize"

    def test_vt02_emphasized(self):
        weights = {w.standard_id: w.modifier for w in get_moment_weights("celebration")}
        assert weights["VT-02"] == "emphasize"

    def test_vt03_emphasized(self):
        weights = {w.standard_id: w.modifier for w in get_moment_weights("celebration")}
        assert weights["VT-03"] == "emphasize"

    def test_celebration_suppressed_set(self):
        suppressed = get_suppressed_standards_for_moment("celebration")
        assert "PRF-11" in suppressed

    def test_celebration_weight_count(self):
        """Celebration has exactly 6 weight entries."""
        assert len(get_moment_weights("celebration")) == 6


# ===================================================================
# Trust/permission weights
# ===================================================================

class TestTrustPermissionWeights:
    """Trust/permission: CLR-01↑, VT-04→relax, ACT-01↑, TRN-01↑."""

    def test_clr01_emphasized(self):
        weights = {w.standard_id: w.modifier for w in get_moment_weights("trust_permission")}
        assert weights["CLR-01"] == "emphasize"

    def test_vt04_relaxed(self):
        """VT-04 (hedging) inverts in trust/permission — precision, not weakness."""
        weights = {w.standard_id: w.modifier for w in get_moment_weights("trust_permission")}
        assert weights["VT-04"] == "relax"

    def test_act01_emphasized(self):
        weights = {w.standard_id: w.modifier for w in get_moment_weights("trust_permission")}
        assert weights["ACT-01"] == "emphasize"

    def test_trn01_emphasized(self):
        weights = {w.standard_id: w.modifier for w in get_moment_weights("trust_permission")}
        assert weights["TRN-01"] == "emphasize"

    def test_no_suppressions_in_trust(self):
        """Trust/permission has no suppressed standards."""
        suppressed = get_suppressed_standards_for_moment("trust_permission")
        assert len(suppressed) == 0

    def test_trust_weight_count(self):
        """Trust/permission has exactly 4 weight entries."""
        assert len(get_moment_weights("trust_permission")) == 4


# ===================================================================
# VT-03, ACT-03, ACT-04 additions to existing moments
# ===================================================================

class TestExistingMomentWeightAdditions:
    """Verify VT-03, ACT-03, ACT-04 were added to the right moments."""

    def test_vt03_in_error_recovery(self):
        weights = {w.standard_id: w.modifier for w in get_moment_weights("error_recovery")}
        assert weights.get("VT-03") == "emphasize"

    def test_act03_in_error_recovery(self):
        weights = {w.standard_id: w.modifier for w in get_moment_weights("error_recovery")}
        assert weights.get("ACT-03") == "emphasize"

    def test_act04_in_error_recovery(self):
        weights = {w.standard_id: w.modifier for w in get_moment_weights("error_recovery")}
        assert weights.get("ACT-04") == "emphasize"

    def test_act04_in_empty_state(self):
        weights = {w.standard_id: w.modifier for w in get_moment_weights("empty_state")}
        assert weights.get("ACT-04") == "emphasize"

    def test_error_recovery_weight_count(self):
        """error_recovery now has 8 weights (5 original + VT-03, ACT-03, ACT-04)."""
        assert len(get_moment_weights("error_recovery")) == 8

    def test_empty_state_weight_count(self):
        """empty_state now has 4 weights (3 original + ACT-04)."""
        assert len(get_moment_weights("empty_state")) == 4


# ===================================================================
# Pipeline integration: moment metadata
# ===================================================================

class TestMomentMetadataIntegration:
    """Verify pipeline-facing functions work with new moments."""

    def test_celebration_weights_applied_format(self):
        applied = get_moment_weights_applied("celebration")
        assert "GRM-03(relax)" in applied
        assert "PRF-11(suppress)" in applied
        assert "VT-05(emphasize)" in applied

    def test_trust_weights_applied_format(self):
        applied = get_moment_weights_applied("trust_permission")
        assert "VT-04(relax)" in applied
        assert "CLR-01(emphasize)" in applied

    def test_celebration_suppression_gate(self):
        """PRF-11 should be suppressed in celebration."""
        assert is_standard_suppressed_by_moment("PRF-11", "celebration")
        assert not is_standard_suppressed_by_moment("VT-05", "celebration")

    def test_trust_no_suppression(self):
        """No standards should be suppressed in trust_permission."""
        assert not is_standard_suppressed_by_moment("VT-04", "trust_permission")
        assert not is_standard_suppressed_by_moment("CLR-01", "trust_permission")


# ===================================================================
# Regression: existing moments unchanged
# ===================================================================

class TestExistingMomentsRegression:
    """Verify no existing moment detection was broken."""

    def test_destructive_action(self):
        assert detect_moment("Permanently delete your account?", "short_ui_copy") == "destructive_action"

    def test_error_recovery(self):
        assert detect_moment("Something went wrong", "error_message") == "error_recovery"

    def test_confirmation(self):
        assert detect_moment("Your changes have been saved.", "confirmation") == "confirmation"

    def test_empty_state(self):
        assert detect_moment("No items yet", "short_ui_copy") == "empty_state"

    def test_first_encounter(self):
        assert detect_moment("Welcome to the app!", "short_ui_copy") == "first_encounter"

    def test_decision_point(self):
        assert detect_moment("Compare plans", "short_ui_copy") == "decision_point"

    def test_interruption(self):
        assert detect_moment("Dismiss", "button_cta") == "interruption"

    def test_wayfinding(self):
        assert detect_moment("Settings", "ui_label") == "wayfinding"

    def test_task_execution(self):
        assert detect_moment("Enter your email address", "short_ui_copy") == "task_execution"

    def test_default_browsing(self):
        assert detect_moment("Learn more about our features", "short_ui_copy") == "browsing_discovery"

    def test_existing_suppression_unchanged(self):
        """browsing_discovery still suppresses PRF-11."""
        assert is_standard_suppressed_by_moment("PRF-11", "browsing_discovery")

    def test_existing_weight_counts_unchanged(self):
        """Moments that didn't get new weights should keep their counts."""
        assert len(get_moment_weights("first_encounter")) == 5
        assert len(get_moment_weights("browsing_discovery")) == 2
        assert len(get_moment_weights("decision_point")) == 5
        assert len(get_moment_weights("task_execution")) == 4
        assert len(get_moment_weights("confirmation")) == 3
        assert len(get_moment_weights("destructive_action")) == 4
        assert len(get_moment_weights("interruption")) == 3
        assert len(get_moment_weights("wayfinding")) == 4


# ===================================================================
# Standards coverage: total weighted standards
# ===================================================================

class TestStandardsCoverage:
    """Track the expanding coverage of moment weights."""

    def test_total_weighted_standards(self):
        """Count unique standard IDs that have at least one moment weight."""
        all_weighted = set()
        for weights in MOMENT_WEIGHTS.values():
            for w in weights:
                all_weighted.add(w.standard_id)
        assert len(all_weighted) >= 19, (
            f"Expected ≥19 weighted standards, got {len(all_weighted)}: {sorted(all_weighted)}"
        )

    def test_moment_weight_consistency(self):
        """No moment should have duplicate standard IDs."""
        for moment, weights in MOMENT_WEIGHTS.items():
            ids = [w.standard_id for w in weights]
            assert len(ids) == len(set(ids)), (
                f"{moment} has duplicate standard IDs: {ids}"
            )
