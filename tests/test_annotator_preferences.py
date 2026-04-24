"""Tests for the Session 31 preference-signal extension to the
auto-annotator's precedent index.

Covers:
- `aggregate_preference_signals` rolls up an export dump correctly.
- `_build_precedent_index` merges annotation + preference counts.
- `_build_preference_conflict_index` captures contested tuples.
- `build_calibration_prompt` surfaces contested tuples when present.
- `build_calibration_prompt` stays backwards-compatible when no
  preference signal is supplied.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from annotator_prompt import (  # noqa: E402
    _build_precedent_index,
    _build_preference_conflict_index,
    aggregate_preference_signals,
    build_calibration_prompt,
)


def _case(**overrides):
    return {
        "input": "some copy",
        "content_type": "confirmation",
        "standard_id": "PRF-01",
        "expected": "fail",
        "human_verdict": "fail",
        "human_confidence": "medium",
        "human_notes": "matches PRF-01 on the dismissive verb",
        **overrides,
    }


def _signal(**overrides):
    return {
        "standard_id": "PRF-01",
        "content_type": "confirmation",
        "aligned": 0,
        "conflicting": 0,
        "neither": 0,
        **overrides,
    }


def test_precedent_index_without_signals_matches_legacy():
    index = _build_precedent_index(
        [_case(), _case(), _case(human_verdict="pass")]
    )
    assert index == {
        "PRF-01|confirmation|fail": 2,
        "PRF-01|confirmation|pass": 1,
    }


def test_precedent_index_folds_aligned_preferences_into_pass_key():
    index = _build_precedent_index(
        [_case()],
        preference_signals=[_signal(aligned=3)],
    )
    assert index["PRF-01|confirmation|fail"] == 1
    assert index["PRF-01|confirmation|pass"] == 3


def test_precedent_index_ignores_conflicting_preferences():
    index = _build_precedent_index(
        [_case()],
        preference_signals=[_signal(aligned=0, conflicting=4)],
    )
    # Conflicting responses don't bump the pass count — they live in
    # the conflict index the prompt renders separately.
    assert "PRF-01|confirmation|pass" not in index


def test_conflict_index_counts_conflicting_responses():
    out = _build_preference_conflict_index(
        [_signal(conflicting=2), _signal(standard_id="TN-01", conflicting=1)]
    )
    assert out == {
        "PRF-01|confirmation": 2,
        "TN-01|confirmation": 1,
    }


def test_conflict_index_empty_for_no_signals():
    assert _build_preference_conflict_index(None) == {}
    assert _build_preference_conflict_index([]) == {}


def test_aggregate_preference_signals_buckets_by_pair_context():
    export = {
        "items": [
            {
                "pair": {
                    "standard_id": "PRF-01",
                    "content_type": "confirmation",
                    "expected_preferred": "left",
                },
                "responses": [
                    {"preferred": "left"},
                    {"preferred": "left"},
                    {"preferred": "right"},
                    {"preferred": "neither"},
                ],
            },
            {
                "pair": {
                    "standard_id": "PRF-01",
                    "content_type": "confirmation",
                    "expected_preferred": "right",
                },
                "responses": [
                    {"preferred": "right"},
                    {"preferred": "left"},
                ],
            },
        ]
    }
    signals = aggregate_preference_signals(export)
    assert len(signals) == 1
    assert signals[0]["standard_id"] == "PRF-01"
    assert signals[0]["content_type"] == "confirmation"
    assert signals[0]["aligned"] == 3  # two lefts + one right on its own pair
    assert signals[0]["conflicting"] == 2
    assert signals[0]["neither"] == 1


def test_aggregate_preference_signals_treats_missing_expected_as_probe():
    export = {
        "items": [
            {
                "pair": {
                    "standard_id": "TN-01",
                    "content_type": "nav_label",
                    "expected_preferred": None,
                },
                "responses": [
                    {"preferred": "left"},
                    {"preferred": "right"},
                ],
            }
        ]
    }
    signals = aggregate_preference_signals(export)
    assert signals[0]["aligned"] == 0
    assert signals[0]["conflicting"] == 0
    assert signals[0]["neither"] == 2


def test_aggregate_preference_signals_skips_malformed_pairs():
    export = {
        "items": [
            {"pair": {}, "responses": [{"preferred": "left"}]},
            {
                "pair": {"standard_id": "PRF-01"},
                "responses": [{"preferred": "left"}],
            },
        ]
    }
    assert aggregate_preference_signals(export) == []


def test_build_calibration_prompt_is_backwards_compatible():
    prompt = build_calibration_prompt([_case()], max_examples=1)
    assert "Contested tuples" not in prompt
    assert "Precedent index" in prompt


def test_build_calibration_prompt_surfaces_contested_tuples():
    prompt = build_calibration_prompt(
        [_case()],
        max_examples=1,
        preference_signals=[_signal(aligned=1, conflicting=3)],
    )
    assert "Contested tuples" in prompt
    assert "PRF-01|confirmation" in prompt


def test_build_calibration_prompt_counts_preferences_into_precedent_index():
    prompt = build_calibration_prompt(
        [_case()],
        max_examples=1,
        preference_signals=[_signal(aligned=4)],
    )
    # Annotation contributed fail=1; preferences contributed pass=4.
    assert '"PRF-01|confirmation|fail": 1' in prompt
    assert '"PRF-01|confirmation|pass": 4' in prompt
