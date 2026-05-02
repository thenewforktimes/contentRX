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
    REVIEW_ENSEMBLE_DISAGREEMENT,
    REVIEW_LOW_CONFIDENCE,
    REVIEW_NOVEL_PATTERN,
    REVIEW_OUT_OF_DISTRIBUTION,
    REVIEW_REASON_PRECEDENCE,
    REVIEW_SITUATION_AMBIGUITY,
    REVIEW_STANDARDS_CONFLICT,
    SCHEMA_VERSION,
    VALID_REVIEW_REASONS,
    VALID_VERDICTS,
    VERDICT_ERROR,
    VERDICT_PASS,
    VERDICT_REVIEW_RECOMMENDED,
    VERDICT_VIOLATION,
    Violation,
    derive_verdict,
)


class TestSchemaVersionBump:
    def test_schema_version_is_current(self):
        # 2.0.0 — ADR 2026-04-25 (private-taxonomy pivot): public
        # Violation envelope reduced to {issue, suggestion, severity,
        # confidence}; docs_url removed entirely.
        # 2.1.0 — additive metering block (TS-side only).
        # 2.2.0 — additive content_type + moment on the public
        # envelope (customer-grounding fields).
        assert SCHEMA_VERSION == "2.2.0"


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


def _high_conf_violation() -> Violation:
    return Violation(
        standard_id="CLR-01", rule="r", issue="i", suggestion="s",
        source="llm", confidence=0.9,
    )


class TestReviewReasonVocabulary:
    """Human-eval build plan Sessions 2 + 13 — typed subtypes."""

    def test_every_constant_is_in_frozenset(self):
        assert REVIEW_LOW_CONFIDENCE in VALID_REVIEW_REASONS
        assert REVIEW_STANDARDS_CONFLICT in VALID_REVIEW_REASONS
        assert REVIEW_ENSEMBLE_DISAGREEMENT in VALID_REVIEW_REASONS
        assert REVIEW_SITUATION_AMBIGUITY in VALID_REVIEW_REASONS
        assert REVIEW_OUT_OF_DISTRIBUTION in VALID_REVIEW_REASONS
        assert REVIEW_NOVEL_PATTERN in VALID_REVIEW_REASONS

    def test_frozenset_has_exactly_six(self):
        # Session 13 added ensemble_disagreement → 6 total.
        assert len(VALID_REVIEW_REASONS) == 6

    def test_precedence_tuple_covers_every_reason(self):
        assert set(REVIEW_REASON_PRECEDENCE) == VALID_REVIEW_REASONS

    def test_precedence_puts_standards_conflict_first(self):
        # standards_conflict is the richest taxonomic signal — it
        # should win over any co-firing subtype.
        assert REVIEW_REASON_PRECEDENCE[0] == REVIEW_STANDARDS_CONFLICT

    def test_precedence_puts_ensemble_disagreement_second(self):
        # Session 13 slot: ensemble_disagreement between
        # standards_conflict and situation_ambiguity.
        assert REVIEW_REASON_PRECEDENCE[1] == REVIEW_ENSEMBLE_DISAGREEMENT

    def test_precedence_puts_low_confidence_last(self):
        # low_confidence is the baseline; a more specific signal
        # should always shadow it.
        assert REVIEW_REASON_PRECEDENCE[-1] == REVIEW_LOW_CONFIDENCE


class TestDeriveVerdictSubtypes:
    """derive_verdict emits the right typed subtype per signal."""

    def test_ensemble_disagreement_emits_when_validate_rejected(self):
        # Session 13: scan_validate_disagreement routes to
        # ensemble_disagreement (not standards_conflict — those are
        # two different things).
        verdict, reason = derive_verdict(
            overall_verdict="fail",
            violations=[_high_conf_violation()],
            scan_validate_disagreement=True,
        )
        assert verdict == VERDICT_REVIEW_RECOMMENDED
        assert reason == REVIEW_ENSEMBLE_DISAGREEMENT

    def test_standards_conflict_emits_on_multi_standard_signal(self):
        # Reserved kwarg: multi-standard taxonomy conflict. Distinct
        # from ensemble disagreement.
        verdict, reason = derive_verdict(
            overall_verdict="fail",
            violations=[_high_conf_violation()],
            standards_conflict=True,
        )
        assert verdict == VERDICT_REVIEW_RECOMMENDED
        assert reason == REVIEW_STANDARDS_CONFLICT

    def test_situation_ambiguity_emits_when_moment_uncertain(self):
        verdict, reason = derive_verdict(
            overall_verdict="fail",
            violations=[_high_conf_violation()],
            moment_ambiguous=True,
        )
        assert verdict == VERDICT_REVIEW_RECOMMENDED
        assert reason == REVIEW_SITUATION_AMBIGUITY

    def test_out_of_distribution_emits_when_signal_fires(self):
        verdict, reason = derive_verdict(
            overall_verdict="fail",
            violations=[_high_conf_violation()],
            out_of_distribution=True,
        )
        assert verdict == VERDICT_REVIEW_RECOMMENDED
        assert reason == REVIEW_OUT_OF_DISTRIBUTION

    def test_novel_pattern_emits_when_signal_fires(self):
        verdict, reason = derive_verdict(
            overall_verdict="fail",
            violations=[_high_conf_violation()],
            novel_pattern=True,
        )
        assert verdict == VERDICT_REVIEW_RECOMMENDED
        assert reason == REVIEW_NOVEL_PATTERN

    def test_low_confidence_still_wins_over_high_confidence_only_path(self):
        """Baseline — low confidence alone emits the low_confidence subtype."""
        v = Violation(
            standard_id="X", rule="", issue="", suggestion="",
            source="llm", confidence=0.5,
        )
        verdict, reason = derive_verdict(
            overall_verdict="fail", violations=[v],
        )
        assert verdict == VERDICT_REVIEW_RECOMMENDED
        assert reason == REVIEW_LOW_CONFIDENCE


class TestDeriveVerdictPrecedence:
    """Multiple signals firing at once — precedence decides the subtype."""

    def test_standards_conflict_beats_ensemble_disagreement(self):
        verdict, reason = derive_verdict(
            overall_verdict="fail",
            violations=[_high_conf_violation()],
            standards_conflict=True,
            scan_validate_disagreement=True,
        )
        assert reason == REVIEW_STANDARDS_CONFLICT

    def test_ensemble_disagreement_beats_situation_ambiguity(self):
        verdict, reason = derive_verdict(
            overall_verdict="fail",
            violations=[_high_conf_violation()],
            scan_validate_disagreement=True,
            moment_ambiguous=True,
        )
        assert reason == REVIEW_ENSEMBLE_DISAGREEMENT

    def test_ensemble_disagreement_beats_low_confidence(self):
        low = Violation(
            standard_id="X", rule="", issue="", suggestion="",
            source="llm", confidence=0.4,
        )
        verdict, reason = derive_verdict(
            overall_verdict="fail",
            violations=[low],
            scan_validate_disagreement=True,
        )
        assert reason == REVIEW_ENSEMBLE_DISAGREEMENT

    def test_situation_ambiguity_beats_low_confidence(self):
        low = Violation(
            standard_id="X", rule="", issue="", suggestion="",
            source="llm", confidence=0.4,
        )
        verdict, reason = derive_verdict(
            overall_verdict="fail",
            violations=[low],
            moment_ambiguous=True,
        )
        assert reason == REVIEW_SITUATION_AMBIGUITY

    def test_all_signals_firing_gives_standards_conflict(self):
        low = Violation(
            standard_id="X", rule="", issue="", suggestion="",
            source="llm", confidence=0.4,
        )
        verdict, reason = derive_verdict(
            overall_verdict="fail",
            violations=[low],
            standards_conflict=True,
            scan_validate_disagreement=True,
            moment_ambiguous=True,
            out_of_distribution=True,
            novel_pattern=True,
        )
        # Precedence order: standards_conflict wins over everything.
        assert reason == REVIEW_STANDARDS_CONFLICT

    def test_no_signals_and_high_confidence_gives_violation(self):
        verdict, reason = derive_verdict(
            overall_verdict="fail",
            violations=[_high_conf_violation()],
        )
        # No review signals, all violations confident → plain violation.
        assert verdict == VERDICT_VIOLATION
        assert reason is None

    def test_ensemble_disagreement_flips_to_review_even_with_no_violations(self):
        """Session 13: validate-rejection-with-nothing-surviving is
        still an ensemble disagreement worth Robert's review.

        Overrides the Session 2 behavior that required at least one
        violation to flip to review_recommended.
        """
        verdict, reason = derive_verdict(
            overall_verdict="pass",
            violations=[],
            scan_validate_disagreement=True,
        )
        assert verdict == VERDICT_REVIEW_RECOMMENDED
        assert reason == REVIEW_ENSEMBLE_DISAGREEMENT

    def test_no_violations_no_signals_still_pass(self):
        verdict, reason = derive_verdict(
            overall_verdict="pass",
            violations=[],
        )
        assert verdict == VERDICT_PASS
        assert reason is None

    def test_signals_ignored_when_error(self):
        verdict, reason = derive_verdict(
            overall_verdict="error",
            violations=[],
            scan_validate_disagreement=True,
        )
        assert verdict == VERDICT_ERROR
        assert reason is None

    # v4.7.1 — situation_ambiguity carve-out. The moment heuristic falls
    # back to MOMENT_CONFIDENCE_FALLBACK (0.5) for any input that doesn't
    # trip a specific pattern, which means most innocuous UI copy without
    # an explicit moment param trips moment_ambiguous. Pre-4.7.1 this
    # downgraded ALL such cases to review_recommended — including empty-
    # violations PASSes ("Save changes" / button_cta returning verdict
    # "review_recommended" with no violations to review).

    def test_situation_ambiguity_alone_no_violations_passes(self):
        """Sole signal + no violations → pass. The human has nothing
        to adjudicate; surfacing it as review_recommended is noise."""
        verdict, reason = derive_verdict(
            overall_verdict="pass",
            violations=[],
            moment_ambiguous=True,
        )
        assert verdict == VERDICT_PASS
        assert reason is None

    def test_situation_ambiguity_with_violations_still_review(self):
        """When there's an actual violation, ambiguity still surfaces —
        the human decides whether the moment changes the answer."""
        verdict, reason = derive_verdict(
            overall_verdict="fail",
            violations=[_high_conf_violation()],
            moment_ambiguous=True,
        )
        assert verdict == VERDICT_REVIEW_RECOMMENDED
        assert reason == REVIEW_SITUATION_AMBIGUITY

    def test_situation_ambiguity_with_other_signal_still_review(self):
        """When a stronger signal also fires, the carve-out does NOT
        suppress — the stronger signal wins on precedence and review
        still emits."""
        verdict, reason = derive_verdict(
            overall_verdict="pass",
            violations=[],
            moment_ambiguous=True,
            scan_validate_disagreement=True,
        )
        assert verdict == VERDICT_REVIEW_RECOMMENDED
        # Precedence: ensemble_disagreement beats situation_ambiguity.
        assert reason == REVIEW_ENSEMBLE_DISAGREEMENT
