"""Tests for v4.7.1 house-style P0 (beta-prep rule integration).

Covers the four P0 rules from `_private/beta-prep/rule-integration-plan.md`:

    Rule 1  — GRM-07 em dashes (factual, conf 1.0 → violation)
    Rule 5  — ACC-08 device verbs (shape, conf 0.65 → review_recommended)
    Rule 7  — CLR-03 sentence length (factual, conf 1.0 → violation)
    Rule 10 — CON-02 strict headings (shape, conf 0.65 → review_recommended)

For each rule: 5 violation cases + 5 pass cases. Shape-detection rules
additionally assert the soft-guidance voice ("noticed", "could be
intentional", no "violates"/"incorrect").

Plus an envelope snapshot test confirming no `standard_id` leak in the
public envelope (schema 2.0.0+).

Substrate-internal assertions (verifying standard_id, version, source)
are valid in tests because tests run inside the substrate boundary.
Public surfaces still strip these fields — see TestPublicEnvelopeSnapshot.
"""

from __future__ import annotations

import pytest

from content_checker.audience import Audience
from content_checker.config import is_public_taxonomy_enabled
from content_checker.models import (
    CONFIDENCE_THRESHOLD,
    SCHEMA_VERSION,
    VERDICT_REVIEW_RECOMMENDED,
    VERDICT_VIOLATION,
    CheckResult,
    Violation,
    derive_verdict,
)
from content_checker.preprocess import (
    Outcome,
    check_acc08_device_verbs,
    check_clr03_sentence_length,
    check_con02_strict_headings,
    check_grm07_em_dashes,
    run_preprocess,
)
from content_checker.suggestion_quality import is_slop, sanitize_violations


# ═══════════════════════════════════════════════════════════════════════
# Rule 1 — GRM-07 em dashes (factual, conf 1.0)
# ═══════════════════════════════════════════════════════════════════════


class TestRule1GRM07EmDashes:
    """Em dashes (U+2014) and en dashes (U+2013) are flagged at conf 1.0."""

    @pytest.mark.parametrize("text", [
        "Save your changes — or lose them.",
        "Pricing – starts at $9/mo.",
        "Wait — there's more.",
        "We tried to email you—but it bounced.",
        "Your subscription renews May 4 — don't miss it.",
    ])
    def test_violation_cases_flag(self, text: str):
        result = check_grm07_em_dashes(text)
        assert result.outcome == Outcome.VIOLATION
        assert result.confidence == 1.0
        assert result.standard_id == "GRM-07"

    @pytest.mark.parametrize("text", [
        "Save your changes or lose them.",
        "Pricing starts at $9/mo.",
        "Wait, there's more.",
        "We tried to email you, but it bounced.",
        "Your subscription renews May 4. Don't miss it.",
    ])
    def test_pass_cases_clean(self, text: str):
        result = check_grm07_em_dashes(text)
        assert result.outcome == Outcome.PASS

    def test_grm07_factual_voice_is_direct(self):
        """Factual rules use direct voice — no soft-guidance hedging."""
        result = check_grm07_em_dashes("test — case")
        # Direct voice: states the rule, not "noticed/could be intentional"
        assert "noticed" not in (result.issue or "").lower()
        assert "house style" in (result.issue or "").lower()


# ═══════════════════════════════════════════════════════════════════════
# Rule 5 — ACC-08 device verbs (shape, conf 0.65 → review_recommended)
# ═══════════════════════════════════════════════════════════════════════


class TestRule5ACC08DeviceVerbs:
    """Device-specific verbs flagged at conf 0.65 with soft-guidance voice."""

    @pytest.mark.parametrize("text", [
        "Click the Save button.",
        "Tap the icon to continue.",
        "Hover over the menu.",
        "Click below to start.",
        "Touch the screen to wake.",
    ])
    def test_violation_cases_flag_at_065(self, text: str):
        result = check_acc08_device_verbs(text, Audience.PRODUCT_UI)
        assert result.outcome == Outcome.VIOLATION
        # Shape detection: confidence below threshold so verdict surfaces
        # as review_recommended, not a hard violation.
        assert result.confidence == 0.65
        assert result.confidence < CONFIDENCE_THRESHOLD

    def test_violation_voice_is_soft_guidance(self):
        result = check_acc08_device_verbs(
            "Click the button.", Audience.PRODUCT_UI,
        )
        text = (result.issue or "") + " " + (result.suggestion or "")
        text_lower = text.lower()
        # Soft-guidance voice signals
        assert "noticed" in text_lower
        assert (
            "could be intentional" in text_lower
            or "if you wanted" in text_lower
        )
        # Forbidden voice
        assert "violates" not in text_lower
        assert "incorrect" not in text_lower

    @pytest.mark.parametrize("text", [
        "Select your plan.",
        "Choose a username.",
        "Open the menu.",
        "Save your changes.",
        "Continue to checkout.",
    ])
    def test_pass_cases_no_device_verbs(self, text: str):
        result = check_acc08_device_verbs(text, Audience.PRODUCT_UI)
        # No match → DEFER (no opinion) is the normal "pass-through" outcome.
        assert result.outcome != Outcome.VIOLATION

    def test_native_mobile_audience_passes_unconditionally(self):
        """Conflict 7: native mobile platforms own touch/tap as input
        verbs — ACC-08 must not fire for native_mobile audience."""
        result = check_acc08_device_verbs(
            "Tap to continue.", Audience.NATIVE_MOBILE,
        )
        assert result.outcome == Outcome.PASS

    def test_acc01_owns_click_here(self):
        """Conflict 5: ACC-01 already fires on 'click here' / 'tap here'.
        ACC-08 must defer those substrings to ACC-01."""
        for substring in ("Click here to learn more.", "tap here for help"):
            result = check_acc08_device_verbs(substring, Audience.PRODUCT_UI)
            assert result.outcome != Outcome.VIOLATION


# ═══════════════════════════════════════════════════════════════════════
# Rule 7 — CLR-03 sentence length (factual, conf 1.0)
# ═══════════════════════════════════════════════════════════════════════


class TestRule7CLR03SentenceLength:
    """Sentence-length thresholds: 20 words for short_ui_copy / tooltip /
    error_message; 25 words for long_form_copy; exempt for headings/buttons."""

    @pytest.mark.parametrize("text,content_type", [
        # 22 words in short_ui_copy (over 20-word threshold)
        (
            "When you change your password you will be signed out of every "
            "device and must sign back in to continue using your account.",
            "short_ui_copy",
        ),
        # 26 words in long_form_copy (over 25)
        (
            "We wanted to let you know that the order you placed has "
            "shipped and based on current estimates it should be arriving "
            "to you on Friday morning.",
            "long_form_copy",
        ),
        # 22 words in tooltip_microcopy (over 20)
        (
            "This setting controls whether ContentRX shows the calibration "
            "summary on every check or only when the override stream "
            "indicates active drift movement.",
            "tooltip_microcopy",
        ),
        # 28 words in error_message
        (
            "We tried to verify your payment with your bank but the bank "
            "did not respond within the timeout window so the charge has "
            "not been completed and we will retry later.",
            "error_message",
        ),
        # Multi-sentence with one over threshold (short_ui_copy, 22 words)
        (
            "Saved. Your billing email now uses the address you confirmed "
            "in the verification step we sent earlier this morning to "
            "your old work account.",
            "short_ui_copy",
        ),
    ])
    def test_violation_cases_flag_at_full_confidence(
        self, text: str, content_type: str,
    ):
        result = check_clr03_sentence_length(text, content_type)
        assert result.outcome == Outcome.VIOLATION
        assert result.confidence == 1.0
        assert result.standard_id == "CLR-03"

    @pytest.mark.parametrize("text,content_type", [
        # 19 words in short_ui_copy (just under 20)
        (
            "Your subscription renews May 4. Update your card by then "
            "to avoid a lapse in service today.",
            "short_ui_copy",
        ),
        # 24 words in long_form_copy (under 25)
        (
            "ContentRX evaluates UI copy for tone, clarity, accessibility, "
            "and inclusion against forty-nine private standards trained on "
            "evidence from many writing-craft sources.",
            "long_form_copy",
        ),
        # Long sentence in button_cta (exempt)
        (
            "Click here to begin your seven day free trial of the "
            "professional plan with all the advanced features included.",
            "button_cta",
        ),
        # Long sentence in heading (exempt)
        (
            "Manage your account settings, billing preferences, and team "
            "permissions all from a single dashboard view.",
            "heading",
        ),
        # Short sentence anywhere
        ("Save your changes.", "short_ui_copy"),
    ])
    def test_pass_cases_under_threshold_or_exempt(
        self, text: str, content_type: str,
    ):
        result = check_clr03_sentence_length(text, content_type)
        assert result.outcome != Outcome.VIOLATION


# ═══════════════════════════════════════════════════════════════════════
# Rule 10 — CON-02 strict headings (shape, conf 0.65 → review_recommended)
# ═══════════════════════════════════════════════════════════════════════


class TestRule10CON02StrictHeadings:
    """Title-case shape detection on heading-style content. Sibling to the
    PASS-only check_con02_sentence_case (Conflict 3). Allowlist is a SEED;
    override stream + refinement-log is the real curation mechanism."""

    @pytest.mark.parametrize("text,content_type", [
        ("Manage Your Account", "heading"),
        ("Update Billing Information", "button_cta"),
        ("Welcome To ContentRX", "heading"),
        ("Download My Data", "heading"),
        ("Connect Your Calendar", "ui_label"),
    ])
    def test_violation_cases_flag_at_065(
        self, text: str, content_type: str,
    ):
        result = check_con02_strict_headings(text, content_type)
        assert result.outcome == Outcome.VIOLATION
        # Shape detection: low confidence → review_recommended.
        assert result.confidence == 0.65
        assert result.confidence < CONFIDENCE_THRESHOLD

    def test_violation_voice_is_soft_guidance(self):
        result = check_con02_strict_headings(
            "Manage Your Account", "heading",
        )
        text = (result.issue or "") + " " + (result.suggestion or "")
        text_lower = text.lower()
        assert "noticed" in text_lower
        # Either "could be intentional" OR "if you wanted" — these are
        # the canonical soft-guidance carveouts from the plan.
        assert (
            "could be" in text_lower
            or "if you wanted" in text_lower
        )
        assert "violates" not in text_lower
        assert "incorrect" not in text_lower

    @pytest.mark.parametrize("text,content_type", [
        # Genuine sentence case
        ("Manage your account", "heading"),
        # Single word
        ("Settings", "heading"),
        # Allowlisted safe phrase
        ("Sign in", "button_cta"),
        # Allowlisted acronym (HSA was added in v4.7.1 seed)
        ("Configure HSA", "heading"),
        # Non-heading content type — function exempts it
        ("Manage Your Account today.", "long_form_copy"),
    ])
    def test_pass_cases(self, text: str, content_type: str):
        result = check_con02_strict_headings(text, content_type)
        assert result.outcome != Outcome.VIOLATION

    def test_sentence_case_function_left_untouched(self):
        """Conflict 3: check_con02_sentence_case is PASS-only by design.
        The new strict-headings sibling does not replace it."""
        from content_checker.preprocess import check_con02_sentence_case
        result = check_con02_sentence_case("manage your account")
        # Original function still PASS-only — never returns VIOLATION.
        assert result.outcome != Outcome.VIOLATION


# ═══════════════════════════════════════════════════════════════════════
# Conflict 4 — slop-screen em-dash echo gate
# ═══════════════════════════════════════════════════════════════════════


class TestConflict4SlopScreenEmDashGate:
    """When GRM-07 fires on input, the slop screen must remove em dashes
    from suggestions even when the original had one."""

    def test_echo_exception_holds_when_grm07_inactive(self):
        """Existing behavior preserved when GRM-07 isn't in the violation set."""
        original = "Pre-existing text with — em dash."
        suggestion = "Replacement with — em dash echoed."
        is_bad, reason = is_slop(
            suggestion, original=original, grm07_active=False,
        )
        # Echo exception keeps the LLM's em dash since the original had one.
        assert is_bad is False

    def test_echo_exception_disabled_when_grm07_active(self):
        """Conflict 4: with GRM-07 active, em dash in suggestion is slop
        even when the original input contained one."""
        original = "Pre-existing text with — em dash."
        suggestion = "Replacement with — em dash echoed."
        is_bad, reason = is_slop(
            suggestion, original=original, grm07_active=True,
        )
        assert is_bad is True
        assert reason == "em_dash"

    def test_sanitize_violations_threads_grm07_state(self):
        """sanitize_violations auto-detects GRM-07 in the violation set
        and threads grm07_active=True into the slop screen."""
        violations = [
            Violation(
                standard_id="GRM-07",
                rule="GRM-07",
                issue="Em dash in copy.",
                suggestion="Use a period.",
                source="deterministic",
                confidence=1.0,
            ),
            Violation(
                standard_id="CLR-01",
                rule="Wordy phrase.",
                issue="Wordy phrase.",
                # The LLM echoed the em dash from the input — slop now.
                suggestion="Replacement with — em dash echoed.",
                source="llm",
                confidence=0.85,
            ),
        ]
        replaced = sanitize_violations(
            violations,
            "Pre-existing text with — em dash.",
            Audience.PRODUCT_UI,
        )
        assert replaced == 1
        # The LLM violation's suggestion was replaced with the fallback.
        assert "—" not in violations[1].suggestion


# ═══════════════════════════════════════════════════════════════════════
# Public envelope snapshot — schema 2.2.0 four-field shape
# ═══════════════════════════════════════════════════════════════════════


class TestPublicEnvelopeSnapshot:
    """Snapshot test: the public envelope strips substrate fields. None
    of the seven user-facing surfaces (web dashboard, MCP, CLI, Figma
    plugin, GitHub Action, LSP, editor extensions) ever sees standard_id,
    rule, rule_version, source, related_standards, ambiguity_flag, or
    validate_rejection_reason."""

    def _build_result_with_p0_violations(self) -> CheckResult:
        """Construct a CheckResult with one violation per P0 rule."""
        violations = [
            Violation(
                standard_id="GRM-07",
                rule="No em dashes.",
                issue="Em or en dash in copy. House style: never.",
                suggestion="Use a period, comma, or sentence break.",
                source="deterministic",
                confidence=1.0,
                rule_version="4.7.1",
            ),
            Violation(
                standard_id="ACC-08",
                rule="Device-specific verbs.",
                issue=(
                    "ContentRX noticed 'click' here — could be intentional."
                ),
                suggestion="If you wanted device-neutral, try 'select'.",
                source="deterministic",
                confidence=0.65,
                rule_version="4.7.1",
            ),
            Violation(
                standard_id="CLR-03",
                rule="Sentence length.",
                issue="Sentence is 30 words.",
                suggestion="Split into shorter sentences.",
                source="deterministic",
                confidence=1.0,
                rule_version="4.7.1",
            ),
            Violation(
                standard_id="CON-02",
                rule="Sentence case.",
                issue=(
                    "ContentRX noticed an unusual capitalization — "
                    "could be a proper noun."
                ),
                suggestion="If you wanted sentence case, lowercase.",
                source="deterministic",
                confidence=0.65,
                rule_version="4.7.1",
            ),
        ]
        verdict, review_reason = derive_verdict(
            overall_verdict="fail", violations=violations,
        )
        return CheckResult(
            content_type="heading",
            overall_verdict="fail",
            verdict=verdict,
            review_reason=review_reason,
            violations=violations,
            audience="product_ui",
            moment="browsing_discovery",
        )

    @pytest.mark.skipif(
        is_public_taxonomy_enabled(),
        reason=(
            "PUBLIC_TAXONOMY=true intentionally exposes substrate fields "
            "as reversibility insurance per ADR 2026-04-25. The strict "
            "five-field envelope shape is the production-default behavior."
        ),
    )
    def test_no_substrate_fields_in_public_envelope(self):
        """Per schema 2.5.0: public Violation has issue / suggestion /
        severity / confidence / category. Substrate fields (standard_id,
        rule, rule_version, source, related_standards, ambiguity_flag,
        validate_rejection_reason) stay private."""
        result = self._build_result_with_p0_violations()
        envelope = result.to_public_envelope()

        forbidden_substrate_fields = (
            "standard_id", "rule", "rule_version", "source",
            "related_standards", "ambiguity_flag",
            "validate_rejection_reason", "docs_url",
        )
        for v in envelope["violations"]:
            for field in forbidden_substrate_fields:
                assert field not in v, (
                    f"Substrate field {field!r} leaked into public "
                    f"envelope: {v}"
                )
            # Required public fields (schema 2.5.0)
            assert set(v.keys()) == {
                "issue", "suggestion", "severity", "confidence",
                "category",
            }

    @pytest.mark.skipif(
        not is_public_taxonomy_enabled(),
        reason=(
            "PUBLIC_TAXONOMY=false (default): substrate fields are "
            "stripped, not echoed back."
        ),
    )
    def test_substrate_fields_returned_when_public_taxonomy_enabled(self):
        """Reversibility insurance: with PUBLIC_TAXONOMY=true, public
        violations carry substrate fields back. Code paths gated by the
        flag stay in the codebase even when default off (ADR 2026-04-25)."""
        result = self._build_result_with_p0_violations()
        envelope = result.to_public_envelope()
        for v in envelope["violations"]:
            # Public fields are still always present.
            assert "issue" in v
            assert "suggestion" in v
            assert "severity" in v
            assert "confidence" in v
            # Substrate fields are echoed back in flag-on mode.
            assert "standard_id" in v
            assert "rule_version" in v

    def test_top_level_envelope_shape(self):
        """Public envelope top level: schema_version + verdict +
        review_reason + warnings + violations + content_type + moment.
        No passes / pipeline / rationale_chain / audience leak."""
        result = self._build_result_with_p0_violations()
        envelope = result.to_public_envelope()
        assert envelope["schema_version"] == SCHEMA_VERSION
        assert "violations" in envelope
        assert "verdict" in envelope
        assert "review_reason" in envelope
        assert "warnings" in envelope
        # Schema 2.2.0 additions: customer-grounding fields.
        assert "content_type" in envelope
        assert "moment" in envelope
        # Substrate-only fields must NOT appear at top level.
        for forbidden in ("passes", "pipeline", "rationale_chain", "audience"):
            assert forbidden not in envelope, (
                f"{forbidden!r} leaked into public envelope top level"
            )

    def test_shape_violations_route_to_review_recommended(self):
        """The two shape-detection P0 rules (ACC-08, CON-02 strict) emit
        at conf 0.65, which is below CONFIDENCE_THRESHOLD (0.7). The
        verdict surfaces as review_recommended even though the violations
        are tagged VIOLATION at the preprocessor layer."""
        result = self._build_result_with_p0_violations()
        # Either review_recommended (low_confidence on shape rules) or
        # violation (factual rules). Mix means review wins per
        # derive_verdict's logic — any v.confidence < threshold flips it.
        assert result.verdict == VERDICT_REVIEW_RECOMMENDED
        assert result.review_reason == "low_confidence"


# ═══════════════════════════════════════════════════════════════════════
# Integration: end-to-end run_preprocess with all 4 P0 checks active
# ═══════════════════════════════════════════════════════════════════════


class TestP0Integration:
    """run_preprocess threads audience and surfaces all 4 P0 violations
    end-to-end. Confirms PreprocessResult.confidence flows through to
    Violation.confidence on the deterministic path."""

    def test_all_four_p0_rules_fire_together(self):
        # Designed to trigger all four P0 rules simultaneously:
        #   - em dash → GRM-07 (factual, conf 1.0)
        #   - "Click" → ACC-08 (shape, conf 0.65)
        #   - "Your" capital in heading → CON-02 strict (shape, conf 0.65)
        #   - Long sentence — but heading is exempt for CLR-03.
        text = "Click — Manage Your Account"
        violations = run_preprocess(
            text, "heading", audience=Audience.PRODUCT_UI,
        )
        ids = {v.standard_id for v in violations}
        assert "GRM-07" in ids
        assert "ACC-08" in ids
        assert "CON-02" in ids

        # Verify per-violation confidence routing
        by_id = {v.standard_id: v for v in violations}
        assert by_id["GRM-07"].confidence == 1.0
        assert by_id["ACC-08"].confidence == 0.65
        assert by_id["CON-02"].confidence == 0.65

    def test_native_mobile_suppresses_acc08(self):
        text = "Tap to continue — the app is loading."
        violations = run_preprocess(
            text, "short_ui_copy", audience=Audience.NATIVE_MOBILE,
        )
        ids = {v.standard_id for v in violations}
        # GRM-07 still fires (em dash is universal house style)
        assert "GRM-07" in ids
        # ACC-08 does NOT fire on native mobile
        assert "ACC-08" not in ids

    def test_clr03_threshold_per_content_type(self):
        # 21 words — over the 20-word short threshold, under the 25-word
        # long threshold.
        text = (
            "When you change your password you will be signed out of "
            "every device and must sign in again to continue using "
            "your stored data."
        )
        # short_ui_copy → fires (threshold 20)
        violations = run_preprocess(text, "short_ui_copy")
        assert "CLR-03" in {v.standard_id for v in violations}
        # long_form_copy → passes (threshold 25)
        violations = run_preprocess(text, "long_form_copy")
        assert "CLR-03" not in {v.standard_id for v in violations}
