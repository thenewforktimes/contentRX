"""Tests for `tools/seed_preference_pairs.py`'s pure diff logic.

Human-eval build plan Session 31. DB-hitting code paths (apply_plan)
aren't exercised here — the seeder runs against a live Postgres. The
diff-generation function is where the real bugs hide, and it's pure.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from seed_preference_pairs import diff_rows, load_pairs  # noqa: E402


def _pair(seed_key: str, **overrides):
    base = {
        "seed_key": seed_key,
        "moment": "destructive_action",
        "content_type": "confirmation",
        "standard_id": "PRF-01",
        "left_text": "Left copy",
        "right_text": "Right copy",
        "expected_preferred": "left",
        "prompt": None,
    }
    base.update(overrides)
    return base


def _row(seed_key: str, **overrides):
    base = {
        "seed_key": seed_key,
        "moment": "destructive_action",
        "content_type": "confirmation",
        "standard_id": "PRF-01",
        "left_text": "Left copy",
        "right_text": "Right copy",
        "expected_preferred": "left",
        "prompt": None,
        "retired_at": None,
    }
    base.update(overrides)
    return base


def test_empty_db_yields_all_inserts():
    plan = diff_rows([_pair("a"), _pair("b")], [])
    assert [p["seed_key"] for p in plan["inserts"]] == ["a", "b"]
    assert plan["updates"] == []
    assert plan["retires"] == []


def test_unchanged_rows_are_skipped():
    pairs = [_pair("a")]
    rows = [_row("a")]
    plan = diff_rows(pairs, rows)
    assert plan == {"inserts": [], "updates": [], "retires": []}


def test_text_change_triggers_update():
    pairs = [_pair("a", left_text="NEW")]
    rows = [_row("a")]
    plan = diff_rows(pairs, rows)
    assert [p["seed_key"] for p in plan["updates"]] == ["a"]


def test_retired_row_is_reinstated_when_back_in_json():
    pairs = [_pair("a")]
    rows = [_row("a", retired_at="2026-04-01T00:00:00Z")]
    plan = diff_rows(pairs, rows)
    assert [p["seed_key"] for p in plan["updates"]] == ["a"]


def test_db_row_missing_from_json_is_retired():
    pairs = [_pair("a")]
    rows = [_row("a"), _row("b")]
    plan = diff_rows(pairs, rows)
    assert [r["seed_key"] for r in plan["retires"]] == ["b"]


def test_already_retired_row_is_not_re_retired():
    pairs = []
    rows = [_row("a", retired_at="2026-03-01T00:00:00Z")]
    plan = diff_rows(pairs, rows)
    assert plan["retires"] == []


def test_prompt_change_triggers_update():
    pairs = [_pair("a", prompt="new prompt")]
    rows = [_row("a")]
    plan = diff_rows(pairs, rows)
    assert [p["seed_key"] for p in plan["updates"]] == ["a"]


def test_load_pairs_validates_required_fields(tmp_path):
    path = tmp_path / "pairs.json"
    path.write_text('{"pairs": [{"seed_key": "a"}]}')
    with pytest.raises(ValueError, match="moment"):
        load_pairs(path)


def test_load_pairs_rejects_bad_expected_preferred(tmp_path):
    path = tmp_path / "pairs.json"
    path.write_text(
        '{"pairs": [{'
        '"seed_key": "a", '
        '"moment": "x", '
        '"content_type": "y", '
        '"standard_id": "Z", '
        '"left_text": "l", '
        '"right_text": "r", '
        '"expected_preferred": "middle"'
        '}]}'
    )
    with pytest.raises(ValueError, match="expected_preferred"):
        load_pairs(path)


def test_load_pairs_accepts_seed_file():
    path = Path(__file__).resolve().parents[1] / "evals" / "preference_pairs.json"
    pairs = load_pairs(path)
    assert len(pairs) >= 10
    # Every pair should have the required keys
    for p in pairs:
        for key in ("seed_key", "moment", "content_type", "standard_id"):
            assert p.get(key)
