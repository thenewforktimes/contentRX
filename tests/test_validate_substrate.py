"""Tests for scripts/validate-substrate.py.

The validator gates substrate-repo changes before they break public CI
or Vercel deploys. A bad validator (one that says "OK" when the
substrate is broken, OR fails on valid substrate) is worse than no
validator — false confidence and false alarms both burn cycles. These
tests pin both directions: every error class fires on broken fixtures,
and a clean fixture passes with no errors and no warnings.

The validator script lives under scripts/ rather than src/ because
it's invoked as a script in CI, not imported by the engine. To test
the pure validate() function, we import it via importlib (the hyphen
in `validate-substrate.py` blocks normal import).
"""

from __future__ import annotations

import importlib.util
import sys
from copy import deepcopy
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
_SCRIPT_PATH = REPO_ROOT / "scripts" / "validate-substrate.py"

_spec = importlib.util.spec_from_file_location("_validate_substrate", _SCRIPT_PATH)
assert _spec and _spec.loader
validate_substrate = importlib.util.module_from_spec(_spec)
sys.modules["_validate_substrate"] = validate_substrate
_spec.loader.exec_module(validate_substrate)


# A minimal-but-valid trio of substrate documents. Tests start from
# this and mutate one field to exercise each error class.
def _valid_standards() -> dict:
    return {
        "version": "1.0.0",
        "total_standards": 2,
        "content_types": [
            {"id": "button_cta", "name": "Button / CTA", "description": "x"},
            {"id": "error_message", "name": "Error message", "description": "x"},
        ],
        "categories": [
            {
                "id": "clarity",
                "name": "Clarity",
                "standards": [
                    {
                        "id": "CLR-01",
                        "rule": "Use plain language.",
                        "correct": "Save",
                        "incorrect": "Persist",
                    },
                ],
            },
            {
                "id": "voice",
                "name": "Voice",
                "standards": [
                    {
                        "id": "VT-01",
                        "rule": "Direct.",
                        "correct": "Try again.",
                        "incorrect": "Apologies, but...",
                    },
                ],
            },
        ],
    }


def _valid_moments() -> dict:
    return {
        "schema_version": "1.0.0",
        "total_moments": 1,
        "moments": [
            {
                "id": "decision_point",
                "description": "Where the user picks.",
                "situation_property": None,
                "weights": {"CLR-01": "boost", "VT-01": "neutral"},
            },
        ],
    }


def _valid_ui_specific() -> dict:
    return {
        "schema_version": "1.0.0",
        "description": "x",
        "standards": [
            {"id": "VT-01", "rationale": "x"},
        ],
    }


class TestCleanFixturePasses:
    def test_clean_trio_returns_ok_with_no_warnings(self) -> None:
        result = validate_substrate.validate(
            _valid_standards(), _valid_moments(), _valid_ui_specific(),
        )
        assert result.ok, f"unexpected errors: {result.errors}"
        assert result.warnings == []
        assert result.summary["standards"] == 2
        assert result.summary["content_types"] == 2
        assert result.summary["moments"] == 1
        assert result.summary["ui_specific"] == 1


class TestStandardsLibraryErrors:
    def test_non_semver_version_fails(self) -> None:
        s = _valid_standards()
        s["version"] = "not-a-version"
        r = validate_substrate.validate(s, _valid_moments(), _valid_ui_specific())
        assert any("version" in e for e in r.errors)

    def test_duplicate_standard_id_fails(self) -> None:
        s = _valid_standards()
        s["categories"][1]["standards"][0]["id"] = "CLR-01"  # duplicate
        r = validate_substrate.validate(s, _valid_moments(), _valid_ui_specific())
        assert any("duplicate standard id" in e for e in r.errors)

    def test_invalid_id_shape_fails(self) -> None:
        s = _valid_standards()
        s["categories"][0]["standards"][0]["id"] = "clr1"  # wrong shape
        r = validate_substrate.validate(s, _valid_moments(), _valid_ui_specific())
        assert any("must match" in e for e in r.errors)

    def test_missing_required_field_fails(self) -> None:
        s = _valid_standards()
        del s["categories"][0]["standards"][0]["rule"]
        r = validate_substrate.validate(s, _valid_moments(), _valid_ui_specific())
        assert any("missing required field 'rule'" in e for e in r.errors)

    def test_total_standards_mismatch_fails(self) -> None:
        s = _valid_standards()
        s["total_standards"] = 99  # actually 2 in the fixture
        r = validate_substrate.validate(s, _valid_moments(), _valid_ui_specific())
        assert any("total_standards" in e for e in r.errors)

    def test_duplicate_content_type_id_fails(self) -> None:
        s = _valid_standards()
        s["content_types"].append(
            {"id": "button_cta", "name": "dup", "description": "x"},
        )
        r = validate_substrate.validate(s, _valid_moments(), _valid_ui_specific())
        assert any("duplicate content_type id" in e for e in r.errors)


class TestMomentsErrors:
    def test_duplicate_moment_id_fails(self) -> None:
        m = _valid_moments()
        m["total_moments"] = 2
        m["moments"].append(
            {
                "id": "decision_point",  # dup
                "description": "...",
                "situation_property": None,
                "weights": {},
            },
        )
        r = validate_substrate.validate(_valid_standards(), m, _valid_ui_specific())
        assert any("duplicate moment id" in e for e in r.errors)

    def test_total_moments_mismatch_fails(self) -> None:
        m = _valid_moments()
        m["total_moments"] = 99
        r = validate_substrate.validate(_valid_standards(), m, _valid_ui_specific())
        assert any("total_moments" in e for e in r.errors)


class TestCrossFileWarnings:
    def test_orphan_moment_weight_is_warning_not_error(self) -> None:
        """Moment weights that reference non-existent standard IDs are
        warnings — the engine tolerates them. See ValidationResult docstring.

        Use a 2-4-letter prefix (`XXX-99`) so it matches the validator's
        STANDARD_ID_RE; 5+-letter prefixes are silently ignored as
        non-standard-id-shaped strings.
        """
        m = _valid_moments()
        m["moments"][0]["weights"]["XXX-99"] = "boost"
        r = validate_substrate.validate(_valid_standards(), m, _valid_ui_specific())
        assert r.ok
        assert any(
            "XXX-99" in w and "weights reference" in w for w in r.warnings
        )

    def test_orphan_ui_specific_reference_is_warning_not_error(self) -> None:
        """ui_specific entries pointing at non-existent standard IDs are
        warnings. Caught a real PRF-03 orphan when first wired."""
        u = _valid_ui_specific()
        u["standards"].append({"id": "ZZZ-42", "rationale": "stale"})
        r = validate_substrate.validate(_valid_standards(), _valid_moments(), u)
        assert r.ok
        assert any(
            "ZZZ-42" in w and "ui_specific_standards" in w
            for w in r.warnings
        )


class TestMissingFiles:
    def test_all_three_missing_yields_three_errors(self) -> None:
        r = validate_substrate.validate(None, None, None)
        assert len(r.errors) >= 3

    def test_partial_data_doesnt_crash(self) -> None:
        """Defensive: if standards parses but moments doesn't, the
        cross-file check shouldn't NPE."""
        r = validate_substrate.validate(_valid_standards(), None, _valid_ui_specific())
        assert any("moments_taxonomy" in e for e in r.errors)


class TestImmutabilityOfInputs:
    def test_validate_does_not_mutate_inputs(self) -> None:
        """The validator is called from CI; the data it reads may be
        cached by the loader. Mutating it would silently corrupt
        downstream callers."""
        s = _valid_standards()
        m = _valid_moments()
        u = _valid_ui_specific()
        s_before = deepcopy(s)
        m_before = deepcopy(m)
        u_before = deepcopy(u)
        validate_substrate.validate(s, m, u)
        assert s == s_before
        assert m == m_before
        assert u == u_before
