"""Tests for the eval promotion pipeline.

Covers:
    - Promotion filtering criteria (confidence, corrections, verdicts)
    - Content hashing and deduplication
    - Schema transform from triage → eval format
    - Standard ID resolution from both triage export and auto-annotated schemas
    - Edge cases: pass verdicts without standards, low confidence, etc.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

# Import from the tools directory — these are standalone scripts, not package modules.
# In the real project, you'd run: PYTHONPATH=tools pytest tests/test_promote.py
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

from promote_cases import (
    content_hash,
    is_promotable,
    transform_case,
    _resolve_standard_id,
    load_existing_hashes,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_triage_case(**overrides) -> dict:
    """Factory for triage cases with sensible defaults."""
    base = {
        "case_id": "SCAN-2026-03-29-001",
        "input": "Click here to learn more",
        "content_type": "button_cta",
        "machine_verdict": "fail",
        "violations": [
            {
                "standard_id": "ACT-03",
                "display_label": "Link text",
                "issue": "Uses vague 'click here' link text.",
                "suggestion": "Use descriptive link text.",
                "source": "ai",
            }
        ],
        "human_verdict": "fail",
        "human_confidence": "high",
        "human_notes": "Correctly caught vague link text.",
        "triage_category": "correct",
    }
    base.update(overrides)
    return base


def _make_annotated_case(**overrides) -> dict:
    """Factory for auto-annotated cases (standard_id at top level)."""
    base = {
        "case_id": "EXTRACT Stripe button_cta abc123",
        "standard_id": "ACT-01",
        "input": "Pricing details",
        "expected": "fail",
        "category": "Actionability",
        "content_type": "button_cta",
        "human_verdict": "fail",
        "human_confidence": "high",
        "human_notes": "Button lacks imperative verb.",
        "review_status": "approved",
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# content_hash
# ---------------------------------------------------------------------------

class TestContentHash:
    def test_identical_strings(self):
        assert content_hash("Hello World") == content_hash("Hello World")

    def test_case_insensitive(self):
        assert content_hash("Hello World") == content_hash("hello world")

    def test_whitespace_normalized(self):
        assert content_hash("Hello  World") == content_hash("Hello World")
        assert content_hash("  Hello World  ") == content_hash("Hello World")
        assert content_hash("Hello\nWorld") == content_hash("Hello World")

    def test_different_strings_differ(self):
        assert content_hash("Hello World") != content_hash("Goodbye World")

    def test_returns_hex_string(self):
        h = content_hash("test")
        assert len(h) == 16
        assert all(c in "0123456789abcdef" for c in h)


# ---------------------------------------------------------------------------
# _resolve_standard_id
# ---------------------------------------------------------------------------

class TestResolveStandardId:
    def test_top_level_standard_id(self):
        case = _make_annotated_case(standard_id="ACT-01")
        assert _resolve_standard_id(case) == "ACT-01"

    def test_from_violations_array(self):
        case = _make_triage_case(standard_id=None)
        # Remove top-level if present, violations should be used
        case.pop("standard_id", None)
        assert _resolve_standard_id(case) == "ACT-03"

    def test_top_level_preferred_over_violations(self):
        case = _make_triage_case(standard_id="CLR-01")
        assert _resolve_standard_id(case) == "CLR-01"

    def test_no_standard_anywhere(self):
        case = {"input": "Hello", "violations": []}
        assert _resolve_standard_id(case) is None

    def test_empty_violations_array(self):
        case = _make_triage_case(violations=[])
        case.pop("standard_id", None)
        assert _resolve_standard_id(case) is None

    def test_malformed_violation_entry(self):
        case = {"input": "Hello", "violations": [{"issue": "something"}]}
        assert _resolve_standard_id(case) is None


# ---------------------------------------------------------------------------
# is_promotable
# ---------------------------------------------------------------------------

class TestIsPromotable:
    def test_high_confidence_reviewed_case(self):
        case = _make_triage_case(human_confidence="high")
        assert is_promotable(case) is True

    def test_medium_confidence_promoted(self):
        case = _make_triage_case(human_confidence="medium")
        assert is_promotable(case) is True

    def test_low_confidence_rejected_by_default(self):
        case = _make_triage_case(human_confidence="low")
        assert is_promotable(case) is False

    def test_low_confidence_included_when_opted_in(self):
        case = _make_triage_case(human_confidence="low")
        assert is_promotable(case, include_low=True) is True

    def test_no_human_verdict_rejected(self):
        case = _make_triage_case(human_verdict=None)
        assert is_promotable(case) is False

    def test_correction_always_promoted(self):
        """Human disagrees with machine → highest-signal case."""
        case = _make_triage_case(
            machine_verdict="fail",
            human_verdict="pass",
            human_confidence="low",  # Even low confidence
        )
        assert is_promotable(case) is True

    def test_correction_via_expected_field(self):
        """Auto-annotated cases use 'expected' instead of 'machine_verdict'."""
        case = _make_annotated_case(
            expected="fail",
            human_verdict="pass",
            human_confidence="low",
        )
        assert is_promotable(case) is True

    def test_pass_verdict_without_standard_promoted(self):
        """Pass cases without a specific standard are still valuable."""
        case = _make_triage_case(
            human_verdict="pass",
            violations=[],
            human_confidence="high",
        )
        # Remove standard_id
        case.pop("standard_id", None)
        assert is_promotable(case) is True

    def test_fail_verdict_without_standard_rejected(self):
        """Fail cases MUST have a standard to be useful in evals."""
        case = _make_triage_case(
            human_verdict="fail",
            violations=[],
            human_confidence="high",
        )
        case.pop("standard_id", None)
        assert is_promotable(case) is False


# ---------------------------------------------------------------------------
# transform_case
# ---------------------------------------------------------------------------

class TestTransformCase:
    def test_basic_transform(self):
        case = _make_triage_case()
        result = transform_case(case, source_file="triage/test.json")

        assert result["input"] == "Click here to learn more"
        assert result["expected"] == "fail"  # human_verdict becomes expected
        assert result["content_type"] == "button_cta"
        assert result["standard_id"] == "ACT-03"
        assert result["human_verdict"] == "fail"
        assert result["human_confidence"] == "high"
        assert result["promoted_from"] == "triage/test.json"
        assert result["original_case_id"] == "SCAN-2026-03-29-001"
        assert "promoted_at" in result

    def test_pass_case_gets_sentinel_standard(self):
        case = _make_triage_case(
            human_verdict="pass",
            violations=[],
        )
        case.pop("standard_id", None)
        result = transform_case(case, source_file="test.json")
        assert result["standard_id"] == "_PASS_NO_STANDARD"
        assert result["expected"] == "pass"

    def test_category_from_map(self):
        category_map = {"ACT-03": "Actionability"}
        case = _make_triage_case()
        result = transform_case(case, source_file="test.json", category_map=category_map)
        assert result["category"] == "Actionability"

    def test_case_id_format(self):
        case = _make_triage_case()
        result = transform_case(case, source_file="test.json")
        assert result["case_id"].startswith("TRIAGE ACT-03 button_cta")

    def test_stable_case_id(self):
        """Same input should produce the same case_id."""
        case1 = _make_triage_case()
        case2 = _make_triage_case()
        r1 = transform_case(case1, source_file="test.json")
        r2 = transform_case(case2, source_file="test.json")
        assert r1["case_id"] == r2["case_id"]

    def test_triage_category_preserved(self):
        case = _make_triage_case(triage_category="context_gap")
        result = transform_case(case, source_file="test.json")
        assert result["triage_category"] == "context_gap"

    def test_annotated_case_transform(self):
        """Auto-annotated cases (standard_id at top level) transform correctly."""
        case = _make_annotated_case()
        result = transform_case(case, source_file="test.json")
        assert result["standard_id"] == "ACT-01"
        assert result["expected"] == "fail"


# ---------------------------------------------------------------------------
# load_existing_hashes
# ---------------------------------------------------------------------------

class TestLoadExistingHashes:
    def test_nonexistent_file(self, tmp_path):
        path = tmp_path / "does_not_exist.json"
        assert load_existing_hashes(path) == set()

    def test_loads_hashes_from_eval_file(self, tmp_path):
        eval_file = tmp_path / "test.json"
        eval_file.write_text(json.dumps({
            "cases": [
                {"input": "Hello World"},
                {"input": "Goodbye World"},
            ]
        }))
        hashes = load_existing_hashes(eval_file)
        assert len(hashes) == 2
        assert content_hash("Hello World") in hashes
        assert content_hash("Goodbye World") in hashes

    def test_handles_malformed_json(self, tmp_path):
        bad_file = tmp_path / "bad.json"
        bad_file.write_text("not json")
        assert load_existing_hashes(bad_file) == set()


# ---------------------------------------------------------------------------
# Integration: filter → transform → dedup pipeline
# ---------------------------------------------------------------------------

class TestPromotionPipeline:
    def test_full_pipeline(self):
        """End-to-end: filter, transform, and dedup a batch of cases."""
        cases = [
            _make_triage_case(
                case_id="SCAN-001",
                input="Click here",
                human_verdict="fail",
                human_confidence="high",
            ),
            _make_triage_case(
                case_id="SCAN-002",
                input="Learn more about pricing",
                human_verdict="pass",
                human_confidence="medium",
                violations=[],
            ),
            _make_triage_case(
                case_id="SCAN-003",
                input="Skipped case",
                human_verdict=None,  # Not reviewed
            ),
            _make_triage_case(
                case_id="SCAN-004",
                input="Low confidence",
                human_verdict="fail",
                human_confidence="low",
            ),
        ]
        # Remove standard_id from pass case
        cases[1].pop("standard_id", None)

        promotable = [c for c in cases if is_promotable(c)]
        assert len(promotable) == 2  # SCAN-001 (high) and SCAN-002 (medium)

        eval_cases = [
            transform_case(c, source_file="test.json")
            for c in promotable
        ]
        assert len(eval_cases) == 2
        assert eval_cases[0]["expected"] == "fail"
        assert eval_cases[1]["expected"] == "pass"

    def test_dedup_removes_existing(self):
        """Cases already in the corpus are filtered out."""
        cases = [
            _make_triage_case(input="Already exists", human_confidence="high"),
            _make_triage_case(input="Brand new case", human_confidence="high"),
        ]

        existing = {content_hash("Already exists")}

        eval_cases = [
            transform_case(c, source_file="test.json")
            for c in cases
            if is_promotable(c)
        ]
        deduped = [c for c in eval_cases if content_hash(c["input"]) not in existing]
        assert len(deduped) == 1
        assert deduped[0]["input"] == "Brand new case"
