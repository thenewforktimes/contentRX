"""Tests for v4.5.1 session patches.

Covers:
    P1. compliance_disclosure moment (13th canonical moment)
        - Taxonomy and valid moments registration
        - Tier 1 heuristic detection from regulatory signal patterns
        - Priority ordering (more specific moments still win)
        - Standard weights (CON-02 suppress, CLR-01 relax)
        - Merge-stage suppression for CON-02
        - System prompt section generation
        - Eval case validation (WF-011, WF-012, WF-017)

    P2. TRN-04 content_type_notes._global refinement
        - Standards library surgical patch verification
        - The translator test: colloquial idioms vs established metaphors
        - filter.py _global note collection (fixes pre-existing bug)
        - CLR-01 _global note also collected (regression confirmation)

Test design:
    Each test documents WHY the expected outcome is correct, not just WHAT
    it is. This makes the test file a calibration artifact — when a new
    eval case disagrees with a test, the rationale tells you whether to
    update the test or investigate the pipeline.
"""

import json
from pathlib import Path

import pytest

from content_checker.moments import (
    DEFAULT_MOMENT,
    MOMENT_TAXONOMY,
    MOMENT_WEIGHTS,
    VALID_MOMENTS,
    MomentWeight,
    build_moment_prompt_section,
    detect_moment,
    get_moment_weights,
    get_moment_weights_applied,
    get_suppressed_standards_for_moment,
    is_standard_suppressed_by_moment,
)
from content_checker.filter import filter_standards
from content_checker.standards.loader import load_standards


# ═══════════════════════════════════════════════════════════════════════
# P1: compliance_disclosure moment — taxonomy and registration
# ═══════════════════════════════════════════════════════════════════════


class TestComplianceDisclosureTaxonomy:
    """Verify the 13th moment is properly registered in the moment system."""

    def test_in_taxonomy(self):
        """compliance_disclosure must appear in MOMENT_TAXONOMY."""
        assert "compliance_disclosure" in MOMENT_TAXONOMY

    def test_in_valid_moments(self):
        """compliance_disclosure must be in the VALID_MOMENTS frozenset."""
        assert "compliance_disclosure" in VALID_MOMENTS

    def test_taxonomy_count_is_13(self):
        """We should now have exactly 13 canonical moments."""
        assert len(MOMENT_TAXONOMY) == 13

    def test_taxonomy_description_mentions_regulatory(self):
        """The description should signal regulatory/legal context."""
        desc = MOMENT_TAXONOMY["compliance_disclosure"].lower()
        assert "regulatory" in desc or "legal" in desc or "mandate" in desc

    def test_has_weights(self):
        """compliance_disclosure must have a MOMENT_WEIGHTS entry."""
        assert "compliance_disclosure" in MOMENT_WEIGHTS

    def test_is_not_default_moment(self):
        """compliance_disclosure is not the default — browsing_discovery is."""
        assert DEFAULT_MOMENT == "browsing_discovery"
        assert DEFAULT_MOMENT != "compliance_disclosure"


# ═══════════════════════════════════════════════════════════════════════
# P1: compliance_disclosure — Tier 1 heuristic detection
# ═══════════════════════════════════════════════════════════════════════


class TestComplianceDisclosureDetection:
    """Detection patterns for regulatory/compliance content.

    Each test maps to a signal pattern from PATCH_QUEUE.md or standard
    FDIC/FINRA disclosure language.
    """

    # --- Eval case validation targets ---

    def test_wf011_fdic_disclaimer_title_case(self):
        """WF-011: FINRA/SEC disclaimer uses Title Case by convention.
        This is the primary eval case that surfaced the moment.
        """
        text = "Investment and Insurance Products are:"
        assert detect_moment(text, "short_ui_copy") == "compliance_disclosure"

    def test_wf012_fdic_not_insured(self):
        """WF-012: FDIC regulatory disclosure in Title Case.
        "Not Insured by the FDIC" is legally mandated language.
        """
        text = "Not Insured by the FDIC or Any Federal Government Agency"
        assert detect_moment(text, "short_ui_copy") == "compliance_disclosure"

    def test_wf017_qualification_period(self):
        """WF-017: "Qualification period" and "offer requirements" are
        legally mandated terms, not unnecessarily formal language.
        """
        text = (
            "After the 90-day qualification period, you will receive "
            "your bonus within 30 days of meeting offer requirements."
        )
        assert detect_moment(text, "long_form_copy") == "compliance_disclosure"

    # --- Individual pattern coverage ---

    def test_fdic_uppercase(self):
        """FDIC is the most common US banking regulatory signal.
        Uses short_ui_copy — ui_label with ≤4 words would be caught
        by wayfinding first (correct priority ordering).
        """
        assert detect_moment("Member FDIC", "short_ui_copy") == "compliance_disclosure"

    def test_fdic_lowercase(self):
        """Detection is case-insensitive."""
        assert detect_moment("member fdic", "short_ui_copy") == "compliance_disclosure"

    def test_finra(self):
        """FINRA regulates broker-dealers."""
        text = "FINRA-registered broker-dealer"
        assert detect_moment(text, "short_ui_copy") == "compliance_disclosure"

    def test_sec_standalone(self):
        """SEC as a standalone regulatory body reference."""
        text = "SEC registered investment adviser"
        assert detect_moment(text, "short_ui_copy") == "compliance_disclosure"

    def test_sec_does_not_match_section(self):
        """'section' contains 'sec' but is not a regulatory signal.
        The word-boundary pattern must prevent this false positive.
        """
        text = "See section 4 for more details"
        assert detect_moment(text, "long_form_copy") != "compliance_disclosure"

    def test_sec_does_not_match_secure(self):
        """'secure' contains 'sec' but is not a regulatory signal."""
        text = "Keep your account secure"
        assert detect_moment(text, "short_ui_copy") != "compliance_disclosure"

    def test_sec_does_not_match_second(self):
        """'second' contains 'sec' but is not a regulatory signal."""
        text = "Wait a second while we process"
        assert detect_moment(text, "short_ui_copy") != "compliance_disclosure"

    def test_not_insured(self):
        text = "This product is not insured by any government agency"
        assert detect_moment(text, "long_form_copy") == "compliance_disclosure"

    def test_investment_risks(self):
        text = "Subject to investment risks, including loss of principal"
        assert detect_moment(text, "long_form_copy") == "compliance_disclosure"

    def test_terms_and_conditions(self):
        # "agree to" triggers trust_permission (priority 7) before
        # "terms and conditions" triggers compliance_disclosure (priority 12)
        text = "By proceeding you agree to our terms and conditions"
        assert detect_moment(text, "short_ui_copy") == "trust_permission"

    def test_subject_to_risks(self):
        """The 'subject to .* risks' pattern catches varied risk disclosures."""
        text = "Subject to market risks"
        assert detect_moment(text, "short_ui_copy") == "compliance_disclosure"

    def test_deposit_products_offered_by(self):
        text = "Deposit products offered by Wells Fargo Bank, N.A."
        assert detect_moment(text, "long_form_copy") == "compliance_disclosure"

    def test_guaranteed_by_bank(self):
        text = "Not guaranteed by the bank or any affiliate"
        assert detect_moment(text, "long_form_copy") == "compliance_disclosure"

    def test_federal_government_agency(self):
        text = "Not insured by any federal government agency"
        assert detect_moment(text, "short_ui_copy") == "compliance_disclosure"

    def test_may_lose_value(self):
        """Standard FDIC disclaimer component."""
        text = "Investment products may lose value"
        assert detect_moment(text, "short_ui_copy") == "compliance_disclosure"

    def test_not_a_deposit(self):
        """Standard FDIC disclaimer component.
        Uses short_ui_copy — ui_label with ≤4 words triggers wayfinding first.
        """
        text = "Not a deposit"
        assert detect_moment(text, "short_ui_copy") == "compliance_disclosure"

    def test_not_guaranteed(self):
        """Standard FDIC disclaimer component."""
        text = "Returns are not guaranteed"
        assert detect_moment(text, "short_ui_copy") == "compliance_disclosure"

    def test_offer_requirements(self):
        text = "You must meet all offer requirements within 90 days"
        assert detect_moment(text, "long_form_copy") == "compliance_disclosure"

    # --- False positive guards ---

    def test_normal_product_copy_not_compliance(self):
        """Ordinary product marketing should not trigger compliance."""
        text = "Get started with our premium plan today"
        assert detect_moment(text, "short_ui_copy") != "compliance_disclosure"

    def test_button_save_not_compliance(self):
        """A simple save button is not regulatory content."""
        assert detect_moment("Save changes", "button_cta") != "compliance_disclosure"

    def test_generic_terms_link_not_compliance(self):
        """'Terms' alone isn't enough — needs 'terms and conditions'."""
        text = "Read our terms"
        assert detect_moment(text, "short_ui_copy") != "compliance_disclosure"


# ═══════════════════════════════════════════════════════════════════════
# P1: compliance_disclosure — priority ordering
# ═══════════════════════════════════════════════════════════════════════


class TestComplianceDisclosurePriority:
    """Verify that more specific moments still win over compliance_disclosure.

    The detection order places compliance_disclosure at position 12
    (after task_execution, before the default). All higher-priority
    moments should still take precedence.
    """

    def test_destructive_action_wins(self):
        """Destructive action is the highest-priority moment."""
        text = "Are you sure you want to delete? Not insured by FDIC."
        assert detect_moment(text, "short_ui_copy") == "destructive_action"

    def test_error_recovery_wins_via_content_type(self):
        """error_message content type forces error_recovery."""
        text = "FDIC insurance verification failed"
        assert detect_moment(text, "error_message") == "error_recovery"

    def test_trust_permission_wins_over_compliance(self):
        """'Agree to terms' triggers trust_permission before compliance.
        trust_permission is checked earlier in the priority chain.
        """
        text = "Agree to the terms and conditions"
        # trust_permission pattern matches "agree to" before compliance
        # matches "terms and conditions"
        assert detect_moment(text, "short_ui_copy") == "trust_permission"

    def test_first_encounter_wins_over_compliance(self):
        """Onboarding patterns are higher priority."""
        text = "Welcome to Wells Fargo. Member FDIC."
        assert detect_moment(text, "short_ui_copy") == "first_encounter"

    def test_compliance_wins_over_default(self):
        """Compliance beats the default browsing_discovery fallback."""
        text = "Member FDIC. Equal Housing Lender."
        result = detect_moment(text, "short_ui_copy")
        assert result == "compliance_disclosure"
        assert result != DEFAULT_MOMENT

    def test_compliance_detected_for_tooltip(self):
        """Compliance can be detected even in non-task content types,
        as long as no higher-priority moment matches first.
        tooltip_microcopy ≤20 words triggers task_execution (priority 11)
        before compliance_disclosure (priority 12), so use short_ui_copy.
        """
        text = "FDIC insured up to $250,000"
        assert detect_moment(text, "short_ui_copy") == "compliance_disclosure"

    def test_wayfinding_wins_for_short_ui_label(self):
        """When a compliance signal appears in a very short ui_label,
        wayfinding wins because it's checked first (position 10 vs 12).
        This is correct — the classifier should route these as
        short_ui_copy, not ui_label. This test documents the intentional
        priority decision from PATCH_QUEUE.md.
        """
        text = "Member FDIC"
        assert detect_moment(text, "ui_label") == "wayfinding"


# ═══════════════════════════════════════════════════════════════════════
# P1: compliance_disclosure — standard weights
# ═══════════════════════════════════════════════════════════════════════


class TestComplianceDisclosureWeights:
    """Verify correct weight assignments for the compliance moment.

    Evidence from PATCH_QUEUE.md:
        CON-02 suppress — WF-011/WF-012: Title Case is mandated by convention
        CLR-01 relax — WF-017: legal terms are mandated precision, not jargon
    """

    def test_con02_is_suppressed(self):
        """CON-02 must be suppressed — regulatory disclaimers use Title Case
        by convention or legal mandate (WF-011, WF-012).
        """
        assert is_standard_suppressed_by_moment("CON-02", "compliance_disclosure")

    def test_clr01_is_relaxed_not_suppressed(self):
        """CLR-01 should be relaxed, NOT suppressed. Legal terms may be
        mandated precision (WF-017), but genuine jargon should still be
        flagged. Relax gives the LLM room to distinguish.
        """
        assert not is_standard_suppressed_by_moment("CLR-01", "compliance_disclosure")

        weights = get_moment_weights("compliance_disclosure")
        clr01_weights = [w for w in weights if w.standard_id == "CLR-01"]
        assert len(clr01_weights) == 1
        assert clr01_weights[0].modifier == "relax"

    def test_suppressed_set_contains_only_con02(self):
        """Only CON-02 should be in the suppressed set for compliance."""
        suppressed = get_suppressed_standards_for_moment("compliance_disclosure")
        assert suppressed == frozenset({"CON-02"})

    def test_weight_count(self):
        """compliance_disclosure has exactly 2 weights: CON-02 + CLR-01."""
        weights = get_moment_weights("compliance_disclosure")
        assert len(weights) == 2

    def test_weights_have_rationale(self):
        """Every weight must have a non-empty rationale for the system prompt."""
        weights = get_moment_weights("compliance_disclosure")
        for w in weights:
            assert w.rationale.strip(), f"Empty rationale for {w.standard_id}"

    def test_weights_applied_format(self):
        """Triage metadata format should include both weights."""
        applied = get_moment_weights_applied("compliance_disclosure")
        assert "CON-02(suppress)" in applied
        assert "CLR-01(relax)" in applied


# ═══════════════════════════════════════════════════════════════════════
# P1: compliance_disclosure — system prompt section
# ═══════════════════════════════════════════════════════════════════════


class TestComplianceDisclosurePrompt:
    """Verify the LLM prompt section for compliance_disclosure."""

    def test_prompt_is_non_empty(self):
        """compliance_disclosure must generate a non-empty prompt section."""
        section = build_moment_prompt_section("compliance_disclosure")
        assert len(section) > 0

    def test_prompt_contains_moment_label(self):
        """The prompt should identify the moment by name."""
        section = build_moment_prompt_section("compliance_disclosure")
        assert "compliance disclosure" in section.lower()

    def test_prompt_contains_con02(self):
        """The prompt should mention CON-02 (the suppressed standard)."""
        section = build_moment_prompt_section("compliance_disclosure")
        assert "CON-02" in section

    def test_prompt_contains_clr01(self):
        """The prompt should mention CLR-01 (the relaxed standard)."""
        section = build_moment_prompt_section("compliance_disclosure")
        assert "CLR-01" in section

    def test_prompt_does_not_mention_hard_nuanced(self):
        """System prompt must never reference hard vs nuanced rule types.
        This is a project-wide architectural constraint.
        """
        section = build_moment_prompt_section("compliance_disclosure")
        lower = section.lower()
        assert "hard rule" not in lower
        assert "nuanced" not in lower
        assert "[hard]" not in lower

    def test_all_moments_have_non_empty_prompt(self):
        """Regression: every moment except browsing_discovery should
        produce a non-empty prompt section. Includes the new 13th moment.
        """
        for moment in MOMENT_TAXONOMY:
            if moment == "browsing_discovery":
                continue
            section = build_moment_prompt_section(moment)
            assert len(section) > 0, f"Empty prompt section for {moment}"


# ═══════════════════════════════════════════════════════════════════════
# P2: TRN-04 content_type_notes._global — standards library patch
# ═══════════════════════════════════════════════════════════════════════


class TestTRN04ContentTypeNotes:
    """Verify the TRN-04 surgical patch to standards_library.json.

    The _global note calibrates the LLM to distinguish between:
    - Colloquial idioms with clear plain alternatives → flag (WF-024, WF-036)
    - Established cross-cultural metaphors → pass (WF-042, WF-043, WF-044)

    The test: would a professional translator working in this vertical
    need to look this phrase up, or would they translate it idiomatically
    without hesitation?
    """

    @pytest.fixture
    def standards(self):
        return load_standards()

    def _find_standard(self, standards, standard_id):
        """Locate a standard by ID in the nested category structure."""
        for cat in standards.get("categories", []):
            for std in cat.get("standards", []):
                if std["id"] == standard_id:
                    return std
        return None

    def test_trn04_has_global_note(self, standards):
        """TRN-04 must have a _global content_type_notes entry."""
        trn04 = self._find_standard(standards, "TRN-04")
        assert trn04 is not None, "TRN-04 not found in standards library"
        notes = trn04.get("content_type_notes", {})
        assert "_global" in notes, (
            "TRN-04 missing _global content_type_notes"
        )

    def test_note_mentions_flag_colloquial(self, standards):
        """The note should instruct flagging colloquial expressions."""
        trn04 = self._find_standard(standards, "TRN-04")
        note = trn04["content_type_notes"]["_global"].lower()
        assert "colloquial" in note or "slang" in note

    def test_note_mentions_pass_metaphors(self, standards):
        """The note should instruct passing established metaphors."""
        trn04 = self._find_standard(standards, "TRN-04")
        note = trn04["content_type_notes"]["_global"].lower()
        assert "peace of mind" in note or "metaphor" in note

    def test_note_includes_translator_test(self, standards):
        """The note should include the professional translator test."""
        trn04 = self._find_standard(standards, "TRN-04")
        note = trn04["content_type_notes"]["_global"].lower()
        assert "translator" in note

    def test_note_has_concrete_examples(self, standards):
        """The note should include at least one fail example with alternative."""
        trn04 = self._find_standard(standards, "TRN-04")
        note = trn04["content_type_notes"]["_global"]
        # "tap into" → "use" is the primary example from WF-024
        assert "tap into" in note.lower()

    def test_trn04_routing_metadata_preserved(self, standards):
        """Surgical patch must not damage existing routing metadata.
        This is the critical architectural constraint.
        """
        trn04 = self._find_standard(standards, "TRN-04")
        assert trn04["rule_type"] == "hard"
        assert trn04["checkable_from"] == "plain_text"
        assert "error_message" in trn04["relevant_content_types"]
        assert "short_ui_copy" in trn04["relevant_content_types"]
        assert "long_form_copy" in trn04["relevant_content_types"]


# ═══════════════════════════════════════════════════════════════════════
# P2: filter.py _global note collection fix
# ═══════════════════════════════════════════════════════════════════════


class TestFilterGlobalNotes:
    """Verify that filter_standards() collects _global notes.

    Pre-existing bug: filter.py line 60 only checked
    `if content_type in notes:` — _global notes were never surfaced
    to the validation pass. This fix affects both CLR-01 (existing)
    and TRN-04 (this patch).
    """

    @pytest.fixture
    def standards(self):
        return load_standards()

    def test_trn04_global_note_collected_for_error_message(self, standards):
        """TRN-04's _global note should appear in active_notes when
        filtering for error_message (a content type TRN-04 is relevant to).
        """
        filtered = filter_standards(standards, "error_message")
        notes = filtered["active_notes"]
        trn04_notes = [n for n in notes if n["standard_id"] == "TRN-04"]
        assert len(trn04_notes) >= 1, (
            "TRN-04 _global note not collected for error_message"
        )

    def test_trn04_global_note_collected_for_short_ui_copy(self, standards):
        """TRN-04's _global note should appear for short_ui_copy."""
        filtered = filter_standards(standards, "short_ui_copy")
        notes = filtered["active_notes"]
        trn04_notes = [n for n in notes if n["standard_id"] == "TRN-04"]
        assert len(trn04_notes) >= 1

    def test_clr01_global_note_now_collected(self, standards):
        """CLR-01's _global note should now be collected (was dead code
        before this fix). This is a regression confirmation for the
        pre-existing bug.
        """
        filtered = filter_standards(standards, "error_message")
        notes = filtered["active_notes"]
        clr01_notes = [n for n in notes if n["standard_id"] == "CLR-01"]
        assert len(clr01_notes) >= 1, (
            "CLR-01 _global note not collected — filter _global fix missing"
        )

    def test_global_and_content_type_notes_both_collected(self, standards):
        """When a standard has a _global note and is relevant to the content
        type, the _global note should appear in active_notes.
        CLR-01 has _global and is relevant to error_message.
        """
        filtered = filter_standards(standards, "error_message")
        notes = filtered["active_notes"]
        clr01_notes = [n for n in notes if n["standard_id"] == "CLR-01"]
        assert len(clr01_notes) >= 1

    def test_global_note_not_collected_for_excluded_content_type(self, standards):
        """If a standard isn't relevant to a content type, its _global note
        should NOT be collected (the standard is filtered out entirely).
        """
        # TRN-04 is not relevant to "button_cta"
        filtered = filter_standards(standards, "button_cta")
        notes = filtered["active_notes"]
        trn04_notes = [n for n in notes if n["standard_id"] == "TRN-04"]
        assert len(trn04_notes) == 0, (
            "TRN-04 _global note collected for irrelevant content type"
        )

    def test_filter_counts_unchanged(self, standards):
        """The _global note fix should not change which standards pass
        the filter — only which notes are collected.
        """
        filtered = filter_standards(standards, "error_message")
        assert filtered["filtered_count"] > 0
        assert filtered["total_count"] == 47


# ═══════════════════════════════════════════════════════════════════════
# Cross-patch integration: compliance_disclosure + filter notes
# ═══════════════════════════════════════════════════════════════════════


class TestCrossPatchIntegration:
    """Verify P1 and P2 work together correctly in the pipeline."""

    @pytest.fixture
    def standards(self):
        return load_standards()

    def test_compliance_con02_suppressed_in_merge(self):
        """When compliance_disclosure is detected, CON-02 violations
        should be removed in the merge stage via is_standard_suppressed_by_moment.
        This is the fix for WF-011/WF-012.
        """
        text = "Investment and Insurance Products are:"
        moment = detect_moment(text, "short_ui_copy")
        assert moment == "compliance_disclosure"
        assert is_standard_suppressed_by_moment("CON-02", moment)

    def test_compliance_clr01_reaches_llm_as_relaxed(self):
        """When compliance_disclosure is detected, CLR-01 should NOT be
        suppressed — it reaches the LLM with a 'relax' directive.
        The LLM decides whether 'qualification period' is jargon or
        mandated precision (WF-017).
        """
        text = (
            "After the 90-day qualification period, you will receive "
            "your bonus within 30 days of meeting offer requirements."
        )
        moment = detect_moment(text, "long_form_copy")
        assert moment == "compliance_disclosure"
        assert not is_standard_suppressed_by_moment("CLR-01", moment)

        # CLR-01's _global note should also reach the validation pass
        # via the filter, giving the LLM calibration for its judgment.

    def test_trn04_global_note_content_matches_spec(self, standards):
        """The TRN-04 note text should match PATCH_QUEUE.md spec exactly
        on the key calibration phrases.
        """
        for cat in standards.get("categories", []):
            for std in cat.get("standards", []):
                if std["id"] == "TRN-04":
                    note = std["content_type_notes"]["_global"]
                    # Key phrases from PATCH_QUEUE.md
                    assert "tap into" in note.lower()
                    assert "peace of mind" in note.lower()
                    assert "take control" in note.lower()
                    assert "journey" in note.lower()
                    return
        pytest.fail("TRN-04 not found")
