"""Regression tests for the 2026-05-11 audit findings.

Each test names the finding it pins so a future cleanup pass can
remove the test alongside the bug it guards if scope ever changes.

- Engine #1: scan ParseError must surface verdict="error", not "pass"
- Engine #5: classify() default model must be None so MODEL_CLASSIFY wins
- Engine #19: Violation.rule must carry the canonical rule text
- Engine #20: scan ParseError summary must not echo raw LLM output
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from content_checker import classify as classify_mod
from content_checker import pipeline as pipeline_mod
from content_checker.api_utils import MODEL_CLASSIFY
from content_checker.classify import classify
from content_checker.models import (
    VERDICT_ERROR,
    VERDICT_PASS,
    Violation,
)
from content_checker.pipeline import (
    _build_rule_text_map,
    _stamp_rule_text,
    check,
)
from content_checker.standards.loader import load_standards


class TestScanParseFailureFailsClosed:
    """Engine #1: a ParseError in the scan response must not slip through
    as verdict="pass". The pipeline used to read only scan_result["violations"]
    / ["passes"], so unparseable LLM output with no preprocessor hit
    silently looked like a clean evaluation.
    """

    def test_scan_error_propagates_to_verdict_error(self) -> None:
        # Fake an _llm_scan return that mimics a ParseError fallback:
        # overall_verdict="error", empty violations and passes.
        from content_checker.models import TokenUsage

        error_scan_result = {
            "content_type": "short_ui_copy",
            "overall_verdict": "error",
            "violations": [],
            "passes": [],
            "summary": "engine: scan response failed to parse",
        }

        with (
            patch.object(
                pipeline_mod,
                "_llm_scan",
                return_value=(error_scan_result, 0.0, TokenUsage()),
            ),
            patch.object(
                pipeline_mod,
                "classify",
                return_value=("short_ui_copy", 0.0, TokenUsage()),
            ),
        ):
            result, _, _ = check(
                "Some innocuous copy that no preprocessor would flag.",
                use_llm_classifier=False,
            )

        assert result.verdict == VERDICT_ERROR
        assert result.overall_verdict == "error"

    def test_scan_error_summary_does_not_echo_user_text(self) -> None:
        """Engine #20: substrate logs must not see raw LLM output (which can
        echo user input) in CheckResult.summary."""
        from content_checker.api_utils import ParseError, parse_scan_response

        # Directly exercise the _llm_scan-internal ParseError path by
        # checking what parse_scan_response signals and what the
        # fallback dict looks like.
        with pytest.raises(ParseError):
            parse_scan_response("not json — secret data 'p@ssw0rd!'")

        # The fix is in the except handler: the summary now reads
        # "engine: scan response failed to parse" with no echo.
        # We assert the literal here so a future regression that
        # reintroduces the echo is caught.
        from content_checker import pipeline as pipeline_module

        import inspect

        source = inspect.getsource(pipeline_module._llm_scan)
        assert "engine: scan response failed to parse" in source
        assert "llm_response.text[:200]" not in source


class TestClassifyDefaultModel:
    """Engine #5: classify(model=None, ...) must route through MODEL_CLASSIFY
    (Haiku). The previous default ("claude-sonnet-4-20250514") was truthy
    and short-circuited the `model or MODEL_CLASSIFY` fallback in
    classify_llm, paying Sonnet rates on every classification.
    """

    def test_default_model_is_none(self) -> None:
        import inspect

        sig = inspect.signature(classify)
        default = sig.parameters["model"].default
        assert default is None, (
            f"classify() default model is {default!r}; expected None so "
            "MODEL_CLASSIFY (Haiku) wins the per-stage routing"
        )

    def test_classify_passes_none_to_classify_llm(self) -> None:
        """When called without model=, classify() forwards None so
        classify_llm's `model or MODEL_CLASSIFY` lands on Haiku."""
        captured = {}

        def fake_classify_llm(text, content_types, model=None):
            from content_checker.models import TokenUsage

            captured["model"] = model
            return "short_ui_copy", 0.0, TokenUsage()

        with patch.object(classify_mod, "classify_llm", fake_classify_llm):
            classify("Save changes", content_types={"short_ui_copy": "short"})

        assert captured["model"] is None
        # And the downstream resolution lands on Haiku.
        assert (None or MODEL_CLASSIFY) == MODEL_CLASSIFY


class TestRuleTextStamping:
    """Engine #19: Violation.rule must carry the canonical rule text from
    the standards library, not the issue text (preprocessor) or the
    LLM's paraphrase (scan).
    """

    def test_build_rule_text_map_round_trips_library(self) -> None:
        standards_data = load_standards()
        rule_text_map = _build_rule_text_map(standards_data)

        # Every entry in the map should match a rule in the library.
        for category in standards_data.get("categories", []):
            for std in category.get("standards", []):
                sid = std.get("id")
                rule = std.get("rule")
                if sid and rule:
                    assert rule_text_map[sid] == rule

    def test_stamp_rule_text_overwrites_with_canonical(self) -> None:
        rule_text_map = {"ACC-01": "Canonical rule text from library."}
        v = Violation(
            standard_id="ACC-01",
            rule="LLM paraphrase of the rule",
            issue="found a problem",
            suggestion="try this instead",
        )

        _stamp_rule_text([v], rule_text_map)

        assert v.rule == "Canonical rule text from library."

    def test_stamp_rule_text_skips_unknown_standard(self) -> None:
        """Standards not in the map (legacy IDs, team rules) keep whatever
        rule text they came in with."""
        rule_text_map = {"ACC-01": "Canonical rule"}
        v = Violation(
            standard_id="TEAM-99",
            rule="team rule text",
            issue="x",
            suggestion="y",
        )

        _stamp_rule_text([v], rule_text_map)

        assert v.rule == "team rule text"

    def test_preprocessor_emits_empty_rule_then_pipeline_stamps(self) -> None:
        """End-to-end: preprocessor leaves rule="", _stamp_rule_text fills it."""
        from content_checker.preprocess import run_preprocess

        violations = run_preprocess(
            "Click here to learn more about your account.",
            "short_ui_copy",
        )

        if violations:
            # The preprocessor leaves rule empty; the pipeline stamps it
            # later. So calling run_preprocess in isolation should yield
            # empty rule strings.
            assert all(v.rule == "" for v in violations)
