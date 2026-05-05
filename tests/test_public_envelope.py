"""Schema 2.0.0 public envelope contract.

Locks the privacy boundary at the engine layer. The public envelope
contains only `issue`, `suggestion`, `severity`, `confidence` per
violation, and `schema_version`, `verdict`, `review_reason`, `warnings`
at the top level. Substrate fields (`standard_id`, `rule`, `rule_version`,
`related_standards`, `rationale_chain`, `ambiguity_flag`,
`validate_rejection_reason`, `source`, `passes`, `pipeline`, `moment`,
`audience`, `content_type`, `summary`, `overall_verdict`) MUST NOT
appear in `CheckResult.to_public_envelope()` or `Violation.to_public_dict()`
when `PUBLIC_TAXONOMY=false` (the default).

When `PUBLIC_TAXONOMY=true`, substrate Violation fields are included
inline alongside the public ones (reversibility insurance — see
`decisions/2026-04-25-private-taxonomy-pivot.md`). The envelope shape
itself does not change.
"""

from __future__ import annotations

import pytest

from content_checker.models import (
    SCHEMA_VERSION,
    SEVERITY_HIGH,
    SEVERITY_LOW,
    SEVERITY_MEDIUM,
    CheckResult,
    PassedStandard,
    PipelineMeta,
    RationaleHop,
    Violation,
    derive_severity,
)


PUBLIC_VIOLATION_FIELDS = frozenset({
    "issue", "suggestion", "severity", "confidence",
    # 2.5.0 — customer-facing category derived from substrate
    # standard_id ("Voice & tone", "Mechanics", "Structure",
    # "Accessibility", "Inclusion", "Big picture"). Substrate
    # standard_ids stay private; the category is the customer-facing
    # taxonomy.
    "category",
})

SUBSTRATE_ONLY_VIOLATION_FIELDS = frozenset({
    "standard_id", "rule", "source", "related_standards",
    "ambiguity_flag", "rule_version", "validate_rejection_reason",
})

PUBLIC_ENVELOPE_TOP_LEVEL_FIELDS = frozenset({
    "schema_version", "violations", "verdict", "review_reason",
    "warnings", "content_type", "moment",
    # The holistic rewrite that fires for large inputs (>200 chars).
    # Always present in the envelope (null on small inputs and on
    # clean documents).
    "suggested_rewrite",
    # One-sentence diagnostic; companion to suggested_rewrite.
    # Always present, null when no rewrite was attempted or JSON
    # parse failed.
    "suggested_diagnostic",
})

SUBSTRATE_TOP_LEVEL_FIELDS = frozenset({
    # CheckResult substrate-only top-level fields that MUST NOT appear
    # in the public envelope. content_type + moment moved off this
    # list in 2.2.0 — they describe the customer's own classified
    # input back to them and aren't substrate-only.
    "audience", "summary", "overall_verdict",
    "passes", "pipeline", "rationale_chain",
})


@pytest.fixture
def public_taxonomy_off(monkeypatch: pytest.MonkeyPatch) -> None:
    """Default mode — substrate fields stripped from public envelope."""
    monkeypatch.setenv("PUBLIC_TAXONOMY", "false")


@pytest.fixture
def public_taxonomy_on(monkeypatch: pytest.MonkeyPatch) -> None:
    """Reversibility-insurance mode — substrate fields surface publicly."""
    monkeypatch.setenv("PUBLIC_TAXONOMY", "true")


def make_violation(
    *,
    confidence: float = 0.92,
    severity: str | None = None,
) -> Violation:
    return Violation(
        standard_id="CLR-01",
        rule="Use plain language. Don't use jargon.",
        issue="This destructive confirmation does not name what gets deleted.",
        suggestion="Replace 'Are you sure?' with 'Delete the workspace?'.",
        source="llm",
        confidence=confidence,
        related_standards=["PRF-11"],
        ambiguity_flag=None,
        rule_version="1.0.0",
        validate_rejection_reason=None,
        severity=severity,
    )


def make_check_result(violation: Violation | None = None) -> CheckResult:
    violations = [violation] if violation is not None else []
    return CheckResult(
        content_type="error",
        overall_verdict="fail" if violations else "pass",
        violations=violations,
        passes=[PassedStandard(standard_id="ACT-01", rule="Use specific verbs.")],
        summary="Hand-written engine summary that should NOT leak.",
        audience="product_ui",
        moment="destructive_action",
        pipeline=PipelineMeta(standards_checked=12, standards_total=47),
        verdict="violation" if violations else "pass",
        review_reason=None,
        rationale_chain=[
            RationaleHop(
                step="classify",
                inputs={"text": "<elided>"},
                output={"content_type": "error"},
                confidence=0.95,
                rule_versions={"CLR-01": "1.0.0"},
            ),
        ],
    )


class TestSeverityDerivation:
    def test_high_at_threshold(self) -> None:
        assert derive_severity(0.85) == SEVERITY_HIGH

    def test_high_above_threshold(self) -> None:
        assert derive_severity(0.99) == SEVERITY_HIGH

    def test_medium_at_threshold(self) -> None:
        assert derive_severity(0.65) == SEVERITY_MEDIUM

    def test_medium_band(self) -> None:
        assert derive_severity(0.7) == SEVERITY_MEDIUM
        assert derive_severity(0.84) == SEVERITY_MEDIUM

    def test_low_below_medium(self) -> None:
        assert derive_severity(0.64) == SEVERITY_LOW
        assert derive_severity(0.0) == SEVERITY_LOW


class TestViolationSeverityField:
    def test_severity_auto_derived_from_confidence(self) -> None:
        v = make_violation(confidence=0.92, severity=None)
        assert v.severity == SEVERITY_HIGH

    def test_explicit_severity_wins(self) -> None:
        # Team-rules override path: a per-standard severity from
        # team-rules supersedes the confidence-based derivation.
        v = make_violation(confidence=0.92, severity=SEVERITY_LOW)
        assert v.severity == SEVERITY_LOW


class TestViolationPublicDict:
    def test_default_mode_strips_substrate(
        self, public_taxonomy_off: None,
    ) -> None:
        v = make_violation(confidence=0.92)
        public = v.to_public_dict()

        assert set(public.keys()) == PUBLIC_VIOLATION_FIELDS
        for forbidden in SUBSTRATE_ONLY_VIOLATION_FIELDS:
            assert forbidden not in public, f"{forbidden!r} leaked"

    def test_default_mode_does_not_emit_docs_url(
        self, public_taxonomy_off: None,
    ) -> None:
        # docs_url is removed entirely in schema 2.0.0 — never in public,
        # never in substrate, never anywhere on the wire.
        v = make_violation()
        public = v.to_public_dict()
        substrate = v.to_substrate_dict()

        assert "docs_url" not in public
        assert "docs_url" not in substrate

    def test_public_mode_includes_substrate_fields(
        self, public_taxonomy_on: None,
    ) -> None:
        v = make_violation()
        public = v.to_public_dict()

        # Public fields are still there...
        for required in PUBLIC_VIOLATION_FIELDS:
            assert required in public

        # ...and substrate fields are now alongside them.
        for substrate_field in SUBSTRATE_ONLY_VIOLATION_FIELDS:
            assert substrate_field in public, f"{substrate_field!r} missing"

    def test_substrate_dict_always_includes_substrate(
        self, public_taxonomy_off: None,
    ) -> None:
        # to_substrate_dict ignores the flag — it always returns the
        # full set, because substrate-API callers (founder /admin) need
        # the full taxonomy regardless of the public-mode flag.
        v = make_violation()
        substrate = v.to_substrate_dict()
        for required in SUBSTRATE_ONLY_VIOLATION_FIELDS | PUBLIC_VIOLATION_FIELDS:
            assert required in substrate, f"{required!r} missing from substrate"

    def test_public_dict_carries_severity_string(
        self, public_taxonomy_off: None,
    ) -> None:
        v = make_violation(confidence=0.50)  # → SEVERITY_LOW
        public = v.to_public_dict()
        assert public["severity"] == SEVERITY_LOW


class TestCheckResultPublicEnvelope:
    def test_top_level_shape_is_current_schema(
        self, public_taxonomy_off: None,
    ) -> None:
        result = make_check_result(make_violation())
        envelope = result.to_public_envelope()

        assert set(envelope.keys()) == PUBLIC_ENVELOPE_TOP_LEVEL_FIELDS
        assert envelope["schema_version"] == SCHEMA_VERSION
        # 3.0.0 — BREAKING: collapsed three-tier model. /api/check no
        # longer accepts segment_type; metering uses size_class
        # ("small" / "large") derived from text length.
        assert envelope["schema_version"] == "3.0.0"
        assert envelope["content_type"] == "error"
        assert envelope["moment"] == "destructive_action"

    def test_no_substrate_top_level_fields(
        self, public_taxonomy_off: None,
    ) -> None:
        result = make_check_result(make_violation())
        envelope = result.to_public_envelope()

        for forbidden in SUBSTRATE_TOP_LEVEL_FIELDS:
            assert forbidden not in envelope, (
                f"{forbidden!r} leaked into public envelope"
            )

    def test_violations_carry_only_public_fields_in_default_mode(
        self, public_taxonomy_off: None,
    ) -> None:
        result = make_check_result(make_violation())
        envelope = result.to_public_envelope()

        assert len(envelope["violations"]) == 1
        v_dict = envelope["violations"][0]
        assert set(v_dict.keys()) == PUBLIC_VIOLATION_FIELDS
        for forbidden in SUBSTRATE_ONLY_VIOLATION_FIELDS:
            assert forbidden not in v_dict

    def test_violations_carry_substrate_fields_in_public_mode(
        self, public_taxonomy_on: None,
    ) -> None:
        result = make_check_result(make_violation())
        envelope = result.to_public_envelope()

        v_dict = envelope["violations"][0]
        for required in PUBLIC_VIOLATION_FIELDS | SUBSTRATE_ONLY_VIOLATION_FIELDS:
            assert required in v_dict

    def test_warnings_default_to_empty_list(
        self, public_taxonomy_off: None,
    ) -> None:
        result = make_check_result()
        envelope = result.to_public_envelope()
        assert envelope["warnings"] == []

    def test_warnings_propagate_when_provided(
        self, public_taxonomy_off: None,
    ) -> None:
        result = make_check_result()
        envelope = result.to_public_envelope(
            warnings=["upstream model fell back to Sonnet 3.5"],
        )
        assert envelope["warnings"] == [
            "upstream model fell back to Sonnet 3.5",
        ]

    def test_passes_omitted_from_public_envelope(
        self, public_taxonomy_off: None,
    ) -> None:
        # PassedStandard contains standard_id (substrate) and rule
        # (substrate). The whole `passes` array is dropped from public.
        result = make_check_result(make_violation())
        envelope = result.to_public_envelope()
        assert "passes" not in envelope

    def test_rationale_chain_omitted_from_public_envelope(
        self, public_taxonomy_off: None,
    ) -> None:
        result = make_check_result(make_violation())
        envelope = result.to_public_envelope()
        assert "rationale_chain" not in envelope

    def test_review_reason_passes_through(
        self, public_taxonomy_off: None,
    ) -> None:
        result = make_check_result(make_violation(confidence=0.5))
        result.verdict = "review_recommended"
        result.review_reason = "low_confidence"
        envelope = result.to_public_envelope()

        assert envelope["verdict"] == "review_recommended"
        assert envelope["review_reason"] == "low_confidence"

    def test_pass_verdict_shape(
        self, public_taxonomy_off: None,
    ) -> None:
        result = make_check_result()  # no violations
        envelope = result.to_public_envelope()

        assert envelope["verdict"] == "pass"
        assert envelope["review_reason"] is None
        assert envelope["violations"] == []


class TestSubstrateDict:
    def test_substrate_dict_matches_legacy_to_dict(
        self, public_taxonomy_off: None,
    ) -> None:
        # to_dict() is the backwards-compat alias for to_substrate_dict().
        # Internal callers (eval harness, engine CLI, tools/) keep working.
        v = make_violation()
        assert v.to_dict() == v.to_substrate_dict()

    def test_check_result_substrate_dict_includes_full_substrate(
        self, public_taxonomy_off: None,
    ) -> None:
        result = make_check_result(make_violation())
        substrate = result.to_substrate_dict()

        for required in SUBSTRATE_TOP_LEVEL_FIELDS:
            assert required in substrate, f"{required!r} missing from substrate"
