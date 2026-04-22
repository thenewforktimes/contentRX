"""Tests for the three-state Verdict + derive_verdict (BUILD_PLAN_v2 Session 10).

Covers the pure logic that turns (overall_verdict, violations) into the
calibrated three-state verdict + review_reason. Wiring tests (does
pipeline.check actually populate the new fields?) live in
test_pipeline_run.py.
"""

from __future__ import annotations

from content_checker.models import (
    CONFIDENCE_THRESHOLD,
    DEFAULT_CONFIDENCE_LLM,
    DEFAULT_CONFIDENCE_PREPROCESSOR,
    SCHEMA_VERSION,
    VALID_VERDICTS,
    VERDICT_ERROR,
    VERDICT_PASS,
    VERDICT_REVIEW_RECOMMENDED,
    VERDICT_VIOLATION,
    Violation,
    derive_verdict,
)


class TestSchemaVersionBump:
    def test_schema_version_is_1_1_0(self):
        # v2 Session 10 bump — additive (verdict + confidence + review_reason)
        assert SCHEMA_VERSION == "1.1.0"


class TestVerdictConstants:
    def test_four_canonical_verdicts(self):
        assert VALID_VERDICTS == {
            VERDICT_PASS, VERDICT_VIOLATION,
            VERDICT_REVIEW_RECOMMENDED, VERDICT_ERROR,
        }

    def test_confidence_threshold_matches_spec(self):
        # BUILD_PLAN_v2 Session 10: "LLM confidence < 0.7 → REVIEW"
        assert CONFIDENCE_THRESHOLD == 0.7

    def test_default_confidence_per_source(self):
        assert DEFAULT_CONFIDENCE_PREPROCESSOR == 1.0
        assert 0.7 < DEFAULT_CONFIDENCE_LLM < 1.0


class TestDeriveVerdict:
    def test_no_violations_passes(self):
        verdict, reason = derive_verdict(overall_verdict="pass", violations=[])
        assert verdict == VERDICT_PASS
        assert reason is None

    def test_error_propagates(self):
        verdict, reason = derive_verdict(overall_verdict="error", violations=[])
        assert verdict == VERDICT_ERROR
        assert reason is None

    def test_high_confidence_violations_become_violation(self):
        v = Violation(
            standard_id="CLR-01",
            rule="r", issue="i", suggestion="s",
            source="llm", confidence=0.9,
        )
        verdict, reason = derive_verdict(
            overall_verdict="fail", violations=[v],
        )
        assert verdict == VERDICT_VIOLATION
        assert reason is None

    def test_low_confidence_violation_flips_to_review(self):
        v = Violation(
            standard_id="VT-01",
            rule="r", issue="i", suggestion="s",
            source="llm", confidence=0.5,
        )
        verdict, reason = derive_verdict(
            overall_verdict="fail", violations=[v],
        )
        assert verdict == VERDICT_REVIEW_RECOMMENDED
        assert reason == "low_confidence"

    def test_threshold_boundary_inclusive(self):
        """confidence == THRESHOLD (0.7) should NOT trigger REVIEW."""
        v = Violation(
            standard_id="X", rule="r", issue="i", suggestion="s",
            source="llm", confidence=CONFIDENCE_THRESHOLD,
        )
        verdict, _ = derive_verdict(
            overall_verdict="fail", violations=[v],
        )
        assert verdict == VERDICT_VIOLATION

    def test_threshold_boundary_just_below_triggers(self):
        v = Violation(
            standard_id="X", rule="r", issue="i", suggestion="s",
            source="llm", confidence=CONFIDENCE_THRESHOLD - 0.0001,
        )
        verdict, reason = derive_verdict(
            overall_verdict="fail", violations=[v],
        )
        assert verdict == VERDICT_REVIEW_RECOMMENDED
        assert reason == "low_confidence"

    def test_one_low_one_high_still_triggers_review(self):
        """ANY low-confidence violation flips the whole result to REVIEW."""
        violations = [
            Violation(standard_id="A", rule="", issue="", suggestion="",
                      source="deterministic", confidence=1.0),
            Violation(standard_id="B", rule="", issue="", suggestion="",
                      source="llm", confidence=0.3),
        ]
        verdict, reason = derive_verdict(
            overall_verdict="fail", violations=violations,
        )
        assert verdict == VERDICT_REVIEW_RECOMMENDED
        assert reason == "low_confidence"


class TestViolationConfidence:
    def test_default_confidence_in_to_dict(self):
        v = Violation(standard_id="X", rule="", issue="", suggestion="")
        d = v.to_dict()
        assert d["confidence"] == DEFAULT_CONFIDENCE_LLM

    def test_explicit_confidence_in_to_dict(self):
        v = Violation(
            standard_id="X", rule="", issue="", suggestion="",
            source="deterministic", confidence=1.0,
        )
        d = v.to_dict()
        assert d["confidence"] == 1.0
        assert d["source"] == "deterministic"
