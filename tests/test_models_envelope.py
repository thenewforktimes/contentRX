"""Tests for the API response envelope on the Python side.

The TS layer is the primary source of truth for the envelope (every
public Next.js route wraps via `src/lib/api-envelope.ts`); these tests
cover the mirror dataclass in `content_checker.models` so any future
Python-side API harness produces a matching shape.
"""

from __future__ import annotations

from content_checker.models import (
    CheckResult,
    EvaluationEnvelope,
    SCHEMA_VERSION,
    Violation,
)


class TestSchemaVersion:
    def test_constant_is_string(self):
        assert isinstance(SCHEMA_VERSION, str)

    def test_constant_is_semver_shape(self):
        # 3 dot-separated numeric components
        parts = SCHEMA_VERSION.split(".")
        assert len(parts) == 3
        for p in parts:
            assert p.isdigit()


class TestEvaluationEnvelope:
    def test_default_warnings_is_empty(self):
        env = EvaluationEnvelope(result={"foo": "bar"})
        assert env.warnings == []
        assert env.schema_version == SCHEMA_VERSION

    def test_to_dict_with_plain_dict(self):
        env = EvaluationEnvelope(result={"violations": [], "passes": []})
        d = env.to_dict()
        assert d == {
            "schema_version": SCHEMA_VERSION,
            "result": {"violations": [], "passes": []},
            "warnings": [],
        }

    def test_to_dict_unwraps_result_with_to_dict(self):
        result = CheckResult(content_type="error_message", overall_verdict="pass")
        env = EvaluationEnvelope(result=result)
        d = env.to_dict()
        assert d["schema_version"] == SCHEMA_VERSION
        assert d["result"]["content_type"] == "error_message"
        assert d["result"]["overall_verdict"] == "pass"
        assert d["warnings"] == []

    def test_to_dict_with_warnings(self):
        env = EvaluationEnvelope(
            result={"foo": "bar"},
            warnings=["audience field deprecated; will be removed in 2.0.0"],
        )
        d = env.to_dict()
        assert d["warnings"] == [
            "audience field deprecated; will be removed in 2.0.0"
        ]

    def test_warnings_list_is_independent_per_instance(self):
        a = EvaluationEnvelope(result={"a": 1})
        b = EvaluationEnvelope(result={"b": 2})
        a.warnings.append("test")
        assert b.warnings == []  # field default_factory must not be shared

    def test_envelope_round_trip_preserves_violation_shape(self):
        v = Violation(
            standard_id="CLR-01",
            rule="Use plain language.",
            issue="Jargon detected.",
            suggestion="Try plain alternative.",
            source="llm",
        )
        result = CheckResult(
            content_type="error_message",
            overall_verdict="fail",
            violations=[v],
        )
        env = EvaluationEnvelope(result=result)
        d = env.to_dict()
        assert len(d["result"]["violations"]) == 1
        assert d["result"]["violations"][0]["standard_id"] == "CLR-01"
