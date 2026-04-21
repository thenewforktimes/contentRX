"""Tests for v4.5.0 moment patches.

Covers:
    3. Celebration moment (detection + weights + CON-02 relax)
    4. Trust/permission moment (detection + weights + VT-04 inversion)
    5. Weight additions to existing moments (error_recovery, empty_state)
    6. Moment taxonomy integrity
    7. CLR-01 content_type_notes._global (verified via standards library)
    8. GRM-06 standards library entry
    9. Regression guards

Preprocessor patches (GRM-06 compound modifiers [8 classes], CON-02
safe phrases) moved to test_preprocess.py during M2 consolidation.

Test design:
    Each test documents WHY the expected outcome is correct, not just WHAT
    it is. This makes the test file a calibration artifact — when a new
    eval case disagrees with a test, the rationale tells you whether to
    update the test or investigate the pipeline.
"""

import json
import re
import sys
from pathlib import Path

import pytest

from content_checker.preprocess import (
    Outcome,
    check_con02_sentence_case,
    preprocess,
)

from content_checker.moments import (
    MOMENT_TAXONOMY,
    MOMENT_WEIGHTS,
    VALID_MOMENTS,
    detect_moment,
    get_moment_weights,
    get_suppressed_standards_for_moment,
    is_standard_suppressed_by_moment,
    build_moment_prompt_section,
    get_moment_weights_applied,
    MomentWeight,
)

from content_checker.standards.loader import load_standards


# ═══════════════════════════════════════════════════════════════════════
# 3. Celebration moment
# ═══════════════════════════════════════════════════════════════════════


class TestCelebrationDetection:
    """Celebration moment detection — achievements, milestones, streaks."""

    @pytest.mark.parametrize("text,content_type", [
        ("Congratulations! You earned a badge.", "short_ui_copy"),
        ("Great job completing your profile!", "confirmation"),
        ("Way to go! 5-day streak!", "short_ui_copy"),
        ("You did it!", "short_ui_copy"),
        ("Nice work finishing the tutorial", "short_ui_copy"),
        ("Achievement unlocked: First Post", "short_ui_copy"),
        ("New record! You ran 10 miles.", "short_ui_copy"),
        ("Keep it up! You're on day 7.", "short_ui_copy"),
        ("You're on a roll!", "short_ui_copy"),
        ("Completed 10 challenges this month", "short_ui_copy"),
        ("You leveled up to Gold!", "short_ui_copy"),
        ("Congrats on your milestone!", "short_ui_copy"),
    ])
    def test_celebration_detected(self, text, content_type):
        assert detect_moment(text, content_type) == "celebration"

    def test_celebration_before_confirmation(self):
        """Celebration wins over confirmation — 'Congratulations! Account created.'"""
        result = detect_moment("Congratulations! Your account has been created.", "confirmation")
        assert result == "celebration"

    def test_plain_confirmation_not_celebration(self):
        """Plain confirmations without celebration language stay as confirmation."""
        assert detect_moment("Your changes have been saved.", "confirmation") == "confirmation"
        assert detect_moment("Payment processed successfully.", "confirmation") == "confirmation"


class TestCelebrationWeights:
    """Celebration moment weight calibration."""

    def test_con02_relax(self):
        """CON-02 relaxed — achievement copy uses intentional stylized casing."""
        weights = get_moment_weights("celebration")
        con02 = [w for w in weights if w.standard_id == "CON-02"]
        assert len(con02) == 1
        assert con02[0].modifier == "relax"

    def test_grm03_relax(self):
        """Exclamation marks are earned in celebrations."""
        weights = get_moment_weights("celebration")
        grm03 = [w for w in weights if w.standard_id == "GRM-03"]
        assert len(grm03) == 1
        assert grm03[0].modifier == "relax"

    def test_prf11_suppressed(self):
        """PRF-11 suppressed — 'Great job!' is enthusiasm, not dismissiveness."""
        assert is_standard_suppressed_by_moment("PRF-11", "celebration")

    def test_vt05_emphasized(self):
        """Celebration should feel genuinely warm."""
        weights = get_moment_weights("celebration")
        vt05 = [w for w in weights if w.standard_id == "VT-05"]
        assert len(vt05) == 1
        assert vt05[0].modifier == "emphasize"

    def test_vt02_emphasized(self):
        """Use you/your — this is the user's achievement."""
        weights = get_moment_weights("celebration")
        vt02 = [w for w in weights if w.standard_id == "VT-02"]
        assert len(vt02) == 1
        assert vt02[0].modifier == "emphasize"

    def test_vt03_emphasized(self):
        """Robotic tone undermines the earned emotional beat."""
        weights = get_moment_weights("celebration")
        vt03 = [w for w in weights if w.standard_id == "VT-03"]
        assert len(vt03) == 1
        assert vt03[0].modifier == "emphasize"

    def test_prompt_section_generated(self):
        """Celebration generates a non-empty prompt section."""
        section = build_moment_prompt_section("celebration")
        assert "celebration" in section.lower()
        assert "CON-02" in section

    def test_weights_applied_format(self):
        """get_moment_weights_applied returns formatted strings."""
        applied = get_moment_weights_applied("celebration")
        assert "CON-02(relax)" in applied
        assert "PRF-11(suppress)" in applied


# ═══════════════════════════════════════════════════════════════════════
# 4. Trust/permission moment
# ═══════════════════════════════════════════════════════════════════════


class TestTrustPermissionDetection:
    """Trust/permission moment — consent, verification, permissions."""

    @pytest.mark.parametrize("text,content_type", [
        ("Allow access to your location", "short_ui_copy"),
        ("We collect your data to improve services", "long_form_copy"),
        ("Accept the terms and conditions", "button_cta"),
        ("Verify your identity to continue", "short_ui_copy"),
        ("Enable notifications to stay updated", "short_ui_copy"),
        ("We use your data to personalize content", "long_form_copy"),
        ("Review our privacy policy", "short_ui_copy"),
        ("Grant permission to access your camera", "short_ui_copy"),
        ('"App" would like to access your photos', "short_ui_copy"),
    ])
    def test_trust_detected(self, text, content_type):
        assert detect_moment(text, content_type) == "trust_permission"

    def test_trust_before_decision_point(self):
        """Trust wins over decision_point — 'Allow access' is consent, not pricing."""
        result = detect_moment("Allow access to your contacts", "button_cta")
        assert result == "trust_permission"

    def test_pricing_not_trust(self):
        """Pure pricing content stays as decision_point."""
        result = detect_moment("Compare plans and pricing", "short_ui_copy")
        assert result == "decision_point"


class TestTrustPermissionWeights:
    """Trust/permission weight calibration — VT-04 inversion is the key design."""

    def test_vt04_relaxed(self):
        """VT-04 relaxed — hedging is precision in consent contexts."""
        weights = get_moment_weights("trust_permission")
        vt04 = [w for w in weights if w.standard_id == "VT-04"]
        assert len(vt04) == 1
        assert vt04[0].modifier == "relax"

    def test_clr01_emphasized(self):
        """Can't consent to what you don't understand."""
        weights = get_moment_weights("trust_permission")
        clr01 = [w for w in weights if w.standard_id == "CLR-01"]
        assert len(clr01) == 1
        assert clr01[0].modifier == "emphasize"

    def test_act01_emphasized(self):
        """Permission actions must be unambiguous."""
        weights = get_moment_weights("trust_permission")
        act01 = [w for w in weights if w.standard_id == "ACT-01"]
        assert len(act01) == 1
        assert act01[0].modifier == "emphasize"

    def test_trn01_emphasized(self):
        """Trust copy must be transparent."""
        weights = get_moment_weights("trust_permission")
        trn01 = [w for w in weights if w.standard_id == "TRN-01"]
        assert len(trn01) == 1
        assert trn01[0].modifier == "emphasize"

    def test_no_suppressions(self):
        """Trust/permission has no suppressed standards — everything matters."""
        suppressed = get_suppressed_standards_for_moment("trust_permission")
        assert len(suppressed) == 0


# ═══════════════════════════════════════════════════════════════════════
# 5. Weight additions to existing moments
# ═══════════════════════════════════════════════════════════════════════


class TestErrorRecoveryWeightAdditions:
    """v4.4.2 weight additions to error_recovery."""

    def test_vt03_emphasized(self):
        """Robotic error copy alienates users."""
        weights = get_moment_weights("error_recovery")
        vt03 = [w for w in weights if w.standard_id == "VT-03"]
        assert len(vt03) == 1
        assert vt03[0].modifier == "emphasize"

    def test_act03_emphasized(self):
        """Negative framing compounds anxiety."""
        weights = get_moment_weights("error_recovery")
        act03 = [w for w in weights if w.standard_id == "ACT-03"]
        assert len(act03) == 1
        assert act03[0].modifier == "emphasize"

    def test_act04_emphasized(self):
        """Errors need actionable next steps."""
        weights = get_moment_weights("error_recovery")
        act04 = [w for w in weights if w.standard_id == "ACT-04"]
        assert len(act04) == 1
        assert act04[0].modifier == "emphasize"

    def test_total_error_recovery_weights(self):
        """Error recovery should have 8 weights total."""
        weights = get_moment_weights("error_recovery")
        assert len(weights) == 8


class TestEmptyStateWeightAdditions:
    """v4.4.2 weight addition to empty_state."""

    def test_act04_emphasized(self):
        """Empty states need concrete next steps."""
        weights = get_moment_weights("empty_state")
        act04 = [w for w in weights if w.standard_id == "ACT-04"]
        assert len(act04) == 1
        assert act04[0].modifier == "emphasize"

    def test_total_empty_state_weights(self):
        """Empty state should have 4 weights total."""
        weights = get_moment_weights("empty_state")
        assert len(weights) == 4


# ═══════════════════════════════════════════════════════════════════════
# 6. Moment taxonomy integrity
# ═══════════════════════════════════════════════════════════════════════


class TestMomentTaxonomy:
    """Structural integrity of the moment system."""

    def test_thirteen_moments(self):
        assert len(MOMENT_TAXONOMY) == 13

    def test_all_moments_have_weights(self):
        """Every moment in the taxonomy has a weight block (even if empty)."""
        for moment in MOMENT_TAXONOMY:
            assert moment in MOMENT_WEIGHTS, f"Missing weight block for {moment}"

    def test_valid_moments_matches_taxonomy(self):
        assert VALID_MOMENTS == frozenset(MOMENT_TAXONOMY.keys())

    def test_no_duplicate_weights(self):
        """No moment has the same standard weighted twice."""
        for moment, weights in MOMENT_WEIGHTS.items():
            ids = [w.standard_id for w in weights]
            assert len(ids) == len(set(ids)), (
                f"Duplicate weight in {moment}: {ids}"
            )

    def test_all_modifiers_valid(self):
        """Every weight uses a recognized modifier."""
        valid = {"emphasize", "relax", "suppress"}
        for moment, weights in MOMENT_WEIGHTS.items():
            for w in weights:
                assert w.modifier in valid, (
                    f"Invalid modifier '{w.modifier}' for "
                    f"{w.standard_id} in {moment}"
                )

    def test_prompt_section_all_moments(self):
        """Every non-default moment generates a prompt section."""
        for moment in MOMENT_TAXONOMY:
            if moment == "browsing_discovery":
                continue
            section = build_moment_prompt_section(moment)
            assert len(section) > 0, f"Empty prompt section for {moment}"

    def test_detection_priority_destructive_first(self):
        """Destructive action still wins over everything."""
        text = "Congratulations! Are you sure you want to delete your account?"
        result = detect_moment(text, "short_ui_copy")
        assert result == "destructive_action"

    def test_detection_priority_error_over_celebration(self):
        """Error recovery (via content type) wins when content_type is error_message."""
        result = detect_moment("Great job!", "error_message")
        assert result == "error_recovery"


# ═══════════════════════════════════════════════════════════════════════
# 7. CLR-01 content_type_notes (standards library verification)
# ═══════════════════════════════════════════════════════════════════════


class TestCLR01ContentTypeNotes:
    """Verify CLR-01._global note exists in the standards library."""

    @pytest.fixture
    def standards(self):
        return load_standards()

    def test_clr01_has_global_note(self, standards):
        """CLR-01 should have a _global content_type_notes entry."""
        clr01 = None
        cats = standards.get("categories", [])
        for cat in cats:
            for std in cat.get("standards", []):
                if std["id"] == "CLR-01":
                    clr01 = std
                    break

        assert clr01 is not None, "CLR-01 not found in standards library"
        notes = clr01.get("content_type_notes", {})
        assert "_global" in notes, (
            "CLR-01 missing _global content_type_notes — "
            "run patch_standards_library.py"
        )

        note_text = notes["_global"]
        assert "jargon" in note_text.lower()
        assert "non-standard" in note_text.lower() or "complex" in note_text.lower()
        assert "vacuous" in note_text.lower() or "filler" in note_text.lower()


# ═══════════════════════════════════════════════════════════════════════
# 8. GRM-06 standards library entry
# ═══════════════════════════════════════════════════════════════════════


class TestGRM06StandardsLibrary:
    """Verify GRM-06 exists in the standards library."""

    @pytest.fixture
    def standards(self):
        return load_standards()

    def test_grm06_exists(self, standards):
        found = False
        for cat in standards.get("categories", []):
            for std in cat.get("standards", []):
                if std["id"] == "GRM-06":
                    found = True
                    assert std["rule_type"] == "mechanical"
                    assert std["checkable_from"] == "plain_text"
                    assert "short_ui_copy" in std["relevant_content_types"]
                    assert "long_form_copy" in std["relevant_content_types"]
                    break
        assert found, "GRM-06 not found — run patch_standards_library.py"

    def test_total_standards_updated(self, standards):
        """Total should be 47 after adding GRM-06."""
        assert standards["total_standards"] >= 47


# ═══════════════════════════════════════════════════════════════════════
# 9. Regression guards
# ═══════════════════════════════════════════════════════════════════════


class TestRegressionGuards:
    """Ensure new patches don't break existing behavior."""

    def test_con02_existing_pass_unchanged(self):
        """Normal sentence case still passes."""
        r = check_con02_sentence_case("Manage your preferences")
        assert r.is_pass

    def test_con02_acronym_pass_unchanged(self):
        """Sentence case with acronyms still passes."""
        r = check_con02_sentence_case("Connect to your API")
        assert r.is_pass

    def test_con02_title_case_still_defers(self):
        """Title case still defers (never generates violations)."""
        r = check_con02_sentence_case("Manage Your Notification Preferences")
        assert r.is_defer

    def test_grm06_does_not_interfere_with_grm05(self):
        """GRM-06 and GRM-05 don't conflict on the same text."""
        results = preprocess("Use one time password", "short_ui_copy")
        grm05 = [r for r in results if r.standard_id == "GRM-05"]
        grm06 = [r for r in results if r.standard_id == "GRM-06"]
        assert len(grm05) == 1
        assert len(grm06) == 1

    def test_existing_moments_unchanged(self):
        """Original 10 moments still detect correctly."""
        assert detect_moment("Welcome to the app", "short_ui_copy") == "first_encounter"
        assert detect_moment("Something went wrong", "error_message") == "error_recovery"
        assert detect_moment("Are you sure you want to delete?", "short_ui_copy") == "destructive_action"
        assert detect_moment("No items yet", "short_ui_copy") == "empty_state"
        assert detect_moment("Settings", "ui_label") == "wayfinding"

    def test_confirmation_still_works(self):
        """Plain confirmations not hijacked by celebration."""
        assert detect_moment("Your changes have been saved.", "confirmation") == "confirmation"
        assert detect_moment("Email sent successfully.", "confirmation") == "confirmation"
