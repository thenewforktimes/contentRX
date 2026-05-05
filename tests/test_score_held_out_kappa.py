"""Tests for tools/score_held_out_kappa.py.

The CI environment doesn't have the gitignored corpus under
evals/industry/, so these tests exercise `score()` with a hand-built
corpus + manifest and a stub engine. The CLI-level paths (corpus
missing → exit 3) are not covered here; the same paths in
run_held_out.py already cover that branch.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

# Load the script as a module (it lives outside any package).
_THIS_FILE = Path(__file__).resolve()
_REPO_ROOT = _THIS_FILE.parent.parent
_SCORE_PATH = _REPO_ROOT / "tools" / "score_held_out_kappa.py"

_spec = importlib.util.spec_from_file_location(
    "_score_held_out_kappa", _SCORE_PATH
)
assert _spec and _spec.loader
score_held_out_kappa = importlib.util.module_from_spec(_spec)
sys.modules["_score_held_out_kappa"] = score_held_out_kappa
_spec.loader.exec_module(score_held_out_kappa)


def _manifest_for(entries: list[dict]) -> dict:
    return {
        "schema_version": "1.0.0",
        "corpus_dir": "evals/industry",
        "entries": entries,
    }


def _corpus_for(cases: dict[str, list[dict]]) -> dict:
    """`cases` is `{source_file: [case_dict, ...]}`; we wrap it into the
    nested shape `load_corpus_index` returns."""
    out: dict[str, dict[str, dict]] = {}
    for src, case_list in cases.items():
        out[src] = {str(c["case_id"]): c for c in case_list}
    return out


def test_score_aggregate_kappa_perfect_agreement():
    """When engine matches human on every case, κ ≈ 1.0."""
    entries = [
        {"source_file": "f.json", "case_id": f"c{i}", "standard_id": "ACC-01"}
        for i in range(20)
    ]
    cases = [
        {
            "case_id": f"c{i}",
            "text": f"text {i}",
            "human_verdict": "pass" if i % 3 != 0 else "fail",
        }
        for i in range(20)
    ]

    def stub_engine(case: dict) -> str:
        return case["human_verdict"]

    summary = score_held_out_kappa.score(
        _manifest_for(entries),
        _corpus_for({"f.json": cases}),
        engine_fn=stub_engine,
    )
    assert summary["evaluated"] == 20
    assert summary["kappa"] == 1.0
    assert summary["observed_agreement"] == 1.0


def test_score_aggregate_kappa_partial_agreement():
    """Half of cases disagree → κ in (0, 1)."""
    entries = [
        {"source_file": "f.json", "case_id": f"c{i}", "standard_id": "ACC-01"}
        for i in range(20)
    ]
    # Hand-construct: 10 pass-pass, 5 fail-fail, 3 pass-fail, 2 fail-pass.
    cases = []
    engine_verdicts = {}
    for i in range(10):
        cases.append({"case_id": f"c{i}", "text": "x", "human_verdict": "pass"})
        engine_verdicts[f"c{i}"] = "pass"
    for i in range(10, 15):
        cases.append({"case_id": f"c{i}", "text": "x", "human_verdict": "fail"})
        engine_verdicts[f"c{i}"] = "fail"
    for i in range(15, 18):
        cases.append({"case_id": f"c{i}", "text": "x", "human_verdict": "pass"})
        engine_verdicts[f"c{i}"] = "fail"
    for i in range(18, 20):
        cases.append({"case_id": f"c{i}", "text": "x", "human_verdict": "fail"})
        engine_verdicts[f"c{i}"] = "pass"

    def stub_engine(case: dict) -> str:
        return engine_verdicts[case["case_id"]]

    summary = score_held_out_kappa.score(
        _manifest_for(entries),
        _corpus_for({"f.json": cases}),
        engine_fn=stub_engine,
    )
    assert summary["evaluated"] == 20
    assert summary["observed_agreement"] == 0.75
    # Between zero and one — the exact value depends on marginals.
    assert 0 < summary["kappa"] < 1
    assert summary["ci_low"] < summary["kappa"] < summary["ci_high"]


def test_score_per_standard_skipped_below_min_n():
    """Standards with fewer than MIN_N_FOR_PER_STANDARD pairs don't
    appear in by_standard, but their pairs DO contribute to the
    aggregate."""
    # 5 cases for ACC-01 (below threshold), 12 for CLR-01 (above).
    entries = (
        [
            {"source_file": "f.json", "case_id": f"a{i}", "standard_id": "ACC-01"}
            for i in range(5)
        ]
        + [
            {"source_file": "f.json", "case_id": f"c{i}", "standard_id": "CLR-01"}
            for i in range(12)
        ]
    )
    cases = (
        [{"case_id": f"a{i}", "text": "x", "human_verdict": "pass"} for i in range(5)]
        + [{"case_id": f"c{i}", "text": "x", "human_verdict": "pass" if i % 2 else "fail"} for i in range(12)]
    )

    def stub_engine(case: dict) -> str:
        return case["human_verdict"]

    summary = score_held_out_kappa.score(
        _manifest_for(entries),
        _corpus_for({"f.json": cases}),
        engine_fn=stub_engine,
    )
    assert summary["evaluated"] == 17
    by_standard_ids = {row["standard_id"] for row in summary["by_standard"]}
    # ACC-01 below the per-standard reporting threshold.
    assert "ACC-01" not in by_standard_ids
    # CLR-01 above.
    assert "CLR-01" in by_standard_ids


def test_score_skips_engine_errors_and_missing_humans():
    """When the engine returns None (error) or human_verdict is None,
    those cases drop out of the κ computation."""
    entries = [
        {"source_file": "f.json", "case_id": "c1", "standard_id": "ACC-01"},
        {"source_file": "f.json", "case_id": "c2", "standard_id": "ACC-01"},
        {"source_file": "f.json", "case_id": "c3", "standard_id": "ACC-01"},
        {"source_file": "f.json", "case_id": "missing", "standard_id": "ACC-01"},
    ]
    cases = [
        {"case_id": "c1", "text": "x", "human_verdict": "pass"},
        {"case_id": "c2", "text": "x", "human_verdict": None},  # ← skipped
        {"case_id": "c3", "text": "x", "human_verdict": "fail"},
    ]

    def stub_engine(case: dict) -> str | None:
        if case["case_id"] == "c1":
            return "pass"
        if case["case_id"] == "c3":
            return None  # ← engine error, skipped
        return "pass"

    summary = score_held_out_kappa.score(
        _manifest_for(entries),
        _corpus_for({"f.json": cases}),
        engine_fn=stub_engine,
    )
    # Only c1 contributes (c2 has no human verdict; c3 had an engine
    # error; "missing" isn't in the corpus). κ is undefined for n=1.
    assert summary["evaluated"] == 1
    assert summary["kappa"] is None
