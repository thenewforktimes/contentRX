"""Tests for the held-out manifest tooling (Session 5).

Covers the pure-logic paths in `tools/select_held_out.py` and
`tools/run_held_out.py` using synthetic fixtures so the tests don't
depend on the (gitignored) industry corpus.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# The tools live under the project's `tools/` dir, which isn't a
# package. Add it to sys.path so we can import both.
TOOLS_DIR = Path(__file__).resolve().parent.parent / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import select_held_out as sho  # noqa: E402
import run_held_out as rho  # noqa: E402


# ---------------------------------------------------------------------------
# Fixture builders
# ---------------------------------------------------------------------------


def _eligible(**overrides):
    """Return a minimal eligible case dict; overrides replace defaults."""
    base = {
        "case_id": "x",
        "text": "Click here.",
        "content_type": "button_cta",
        "standard_id": "CLR-01",
        "moment": "browsing_discovery",
        "human_verdict": "pass",
        "human_confidence": "high",
        "review_status": "approved",
    }
    base.update(overrides)
    return base


def _write_corpus(tmp_path: Path, files: dict[str, list[dict]]) -> Path:
    corpus = tmp_path / "industry"
    corpus.mkdir()
    for name, cases in files.items():
        with open(corpus / name, "w") as f:
            json.dump({"cases": cases}, f)
    return corpus


# ---------------------------------------------------------------------------
# is_eligible / load_cases
# ---------------------------------------------------------------------------


class TestIsEligible:
    def test_high_confidence_approved_is_eligible(self):
        assert sho.is_eligible(_eligible())

    def test_medium_confidence_is_not_eligible(self):
        assert not sho.is_eligible(_eligible(human_confidence="medium"))

    def test_low_confidence_is_not_eligible(self):
        assert not sho.is_eligible(_eligible(human_confidence="low"))

    def test_pending_review_is_not_eligible(self):
        assert not sho.is_eligible(_eligible(review_status="pending"))

    def test_excluded_review_is_not_eligible(self):
        assert not sho.is_eligible(_eligible(review_status="excluded"))

    def test_revised_counts_as_approved(self):
        # The plan explicitly allows `approved` AND `revised`.
        assert sho.is_eligible(_eligible(review_status="revised"))


class TestLoadCases:
    def test_attaches_source_file(self, tmp_path):
        corpus = _write_corpus(
            tmp_path, {"a.json": [_eligible(case_id="1")]},
        )
        cases = sho.load_cases(corpus)
        assert cases[0]["_source_file"] == "a.json"

    def test_synthesizes_case_id_when_null(self, tmp_path):
        corpus = _write_corpus(
            tmp_path,
            {"b.json": [_eligible(case_id=None), _eligible(case_id="")]},
        )
        cases = sho.load_cases(corpus)
        assert cases[0]["case_id"] == "auto:b.json:1"
        assert cases[1]["case_id"] == "auto:b.json:2"

    def test_preserves_existing_case_ids(self, tmp_path):
        corpus = _write_corpus(
            tmp_path,
            {"c.json": [_eligible(case_id="real-1"), _eligible(case_id="real-2")]},
        )
        cases = sho.load_cases(corpus)
        assert [c["case_id"] for c in cases] == ["real-1", "real-2"]


# ---------------------------------------------------------------------------
# select_held_out
# ---------------------------------------------------------------------------


class TestSelectionCoverage:
    def test_moment_coverage_prioritizes_five_per_moment(self, tmp_path):
        # 10 browsing_discovery + 10 task_execution; target 10 → should
        # pull ≥5 from each so both moments are represented.
        files = {
            "a.json": [
                _eligible(case_id=f"bd-{i}", moment="browsing_discovery")
                for i in range(10)
            ] + [
                _eligible(case_id=f"te-{i}", moment="task_execution")
                for i in range(10)
            ],
        }
        cases = sho.load_cases(_write_corpus(tmp_path, files))
        selected, stats = sho.select_held_out(cases, target=10)
        moments = {c["moment"] for c in selected}
        assert "browsing_discovery" in moments
        assert "task_execution" in moments
        assert stats["moment_distribution"].get("browsing_discovery", 0) >= 5
        assert stats["moment_distribution"].get("task_execution", 0) >= 5

    def test_standard_coverage_applies_when_standard_has_enough(self, tmp_path):
        files = {
            "a.json": [
                _eligible(case_id=f"c1-{i}", standard_id="CLR-01")
                for i in range(10)
            ] + [
                _eligible(case_id=f"v2-{i}", standard_id="VT-02")
                for i in range(10)
            ],
        }
        cases = sho.load_cases(_write_corpus(tmp_path, files))
        # Target 10 leaves enough budget for both moment + standard
        # coverage to trigger: 5 moment slots + 3 CLR-01 + 2 VT-02
        # (capped by budget) = 10.
        selected, _ = sho.select_held_out(cases, target=10)
        standards = {c["standard_id"] for c in selected}
        # Both standards have ≥3 in pool, so both should be represented.
        assert {"CLR-01", "VT-02"}.issubset(standards)

    def test_skips_standard_coverage_when_pool_too_small(self, tmp_path):
        # CLR-01 has only 2 eligible cases — below the ≥3 floor, so
        # coverage pass 2 should not force them in.
        files = {
            "a.json": [
                _eligible(case_id=f"c1-{i}", standard_id="CLR-01")
                for i in range(2)
            ] + [
                _eligible(case_id=f"v2-{i}", standard_id="VT-02")
                for i in range(10)
            ],
        }
        cases = sho.load_cases(_write_corpus(tmp_path, files))
        selected, _ = sho.select_held_out(cases, target=3)
        # Only moment coverage triggered (browsing_discovery has 12);
        # CLR-01's 2 may or may not show up, but the spec is: they're
        # not FORCED in by the standard-coverage pass.
        clr_selected = [c for c in selected if c["standard_id"] == "CLR-01"]
        assert len(clr_selected) < 3  # never hit the coverage target

    def test_ignores_ineligible_cases(self, tmp_path):
        files = {
            "a.json": [
                _eligible(case_id="keep", human_confidence="high"),
                _eligible(case_id="drop-med", human_confidence="medium"),
                _eligible(case_id="drop-low", human_confidence="low"),
                _eligible(case_id="drop-pending", review_status="pending"),
            ],
        }
        cases = sho.load_cases(_write_corpus(tmp_path, files))
        selected, stats = sho.select_held_out(cases, target=10)
        assert stats["eligible_pool"] == 1
        assert [c["case_id"] for c in selected] == ["keep"]


class TestSelectionDeterminism:
    def test_same_input_produces_same_output(self, tmp_path):
        files = {
            "a.json": [_eligible(case_id=f"id-{i}") for i in range(20)],
        }
        cases = sho.load_cases(_write_corpus(tmp_path, files))
        a, _ = sho.select_held_out(cases, target=10)
        b, _ = sho.select_held_out(cases, target=10)
        assert [c["case_id"] for c in a] == [c["case_id"] for c in b]

    def test_growth_is_stable(self, tmp_path):
        """Adding cases to the pool shouldn't churn existing selections."""
        files_small = {
            "a.json": [_eligible(case_id=f"id-{i}") for i in range(20)],
        }
        small_cases = sho.load_cases(_write_corpus(tmp_path, files_small))
        selected_small, _ = sho.select_held_out(small_cases, target=5)
        # Now add more eligible cases to the same file and re-select.
        files_large = {
            "a.json": [_eligible(case_id=f"id-{i}") for i in range(40)],
        }
        tmp2 = tmp_path / "g"
        tmp2.mkdir()
        large_cases = sho.load_cases(_write_corpus(tmp2, files_large))
        selected_large, _ = sho.select_held_out(large_cases, target=5)
        # The deterministic order pulls the lowest-sorted case_ids
        # first, so the same 5 should come out of both runs.
        assert [c["case_id"] for c in selected_small] == [
            c["case_id"] for c in selected_large
        ]


class TestSelectionTarget:
    def test_returns_target_count_when_pool_large_enough(self, tmp_path):
        files = {
            "a.json": [_eligible(case_id=f"id-{i}") for i in range(50)],
        }
        cases = sho.load_cases(_write_corpus(tmp_path, files))
        selected, stats = sho.select_held_out(cases, target=10)
        assert stats["selected"] == 10
        assert len(selected) == 10

    def test_returns_pool_size_when_pool_smaller_than_target(self, tmp_path):
        files = {
            "a.json": [_eligible(case_id=f"id-{i}") for i in range(7)],
        }
        cases = sho.load_cases(_write_corpus(tmp_path, files))
        selected, stats = sho.select_held_out(cases, target=20)
        assert stats["selected"] == 7
        assert len(selected) == 7

    def test_no_duplicate_case_ids_in_output(self, tmp_path):
        files = {
            "a.json": [
                _eligible(
                    case_id=f"id-{i}",
                    moment="browsing_discovery",
                    standard_id="CLR-01",
                )
                for i in range(20)
            ],
        }
        cases = sho.load_cases(_write_corpus(tmp_path, files))
        selected, _ = sho.select_held_out(cases, target=10)
        ids = [c["case_id"] for c in selected]
        assert len(ids) == len(set(ids))


class TestBuildManifest:
    def test_manifest_structure(self, tmp_path):
        files = {
            "a.json": [_eligible(case_id=f"id-{i}") for i in range(5)],
        }
        cases = sho.load_cases(_write_corpus(tmp_path, files))
        selected, stats = sho.select_held_out(cases, target=3)
        manifest = sho.build_manifest(
            selected, stats,
            corpus_dir=tmp_path,
            target=3,
            generated_at="2026-04-23T00:00:00Z",
        )
        assert manifest["schema_version"] == "1.0.0"
        assert "entries" in manifest
        assert len(manifest["entries"]) == 3
        assert all("selection_reasons" in e for e in manifest["entries"])

    def test_manifest_does_not_include_raw_text(self, tmp_path):
        files = {
            "a.json": [_eligible(case_id="x", text="PRIVATE TEXT")],
        }
        cases = sho.load_cases(_write_corpus(tmp_path, files))
        selected, stats = sho.select_held_out(cases, target=1)
        manifest = sho.build_manifest(
            selected, stats,
            corpus_dir=tmp_path, target=1, generated_at="t",
        )
        entry = manifest["entries"][0]
        # Privacy invariant: raw text stays in the source file.
        assert "text" not in entry
        assert "human_notes" not in entry


# ---------------------------------------------------------------------------
# run_held_out pure logic
# ---------------------------------------------------------------------------


class TestNormalizeVerdict:
    def test_pass_fail_preserved(self):
        assert rho.normalize_verdict("pass") == "pass"
        assert rho.normalize_verdict("fail") == "fail"

    def test_error_becomes_none(self):
        assert rho.normalize_verdict("error") is None

    def test_unknown_becomes_none(self):
        assert rho.normalize_verdict("nonsense") is None
        assert rho.normalize_verdict(None) is None


class TestCohensKappa:
    def test_perfect_agreement_is_one(self):
        pairs = [("pass", "pass"), ("fail", "fail"), ("pass", "pass")]
        assert rho.cohens_kappa(pairs) == pytest.approx(1.0)

    def test_zero_agreement_beyond_chance_is_zero(self):
        # 50/50 marginals, 50% observed → κ = 0.
        pairs = [
            ("pass", "pass"),
            ("pass", "fail"),
            ("fail", "pass"),
            ("fail", "fail"),
        ]
        assert rho.cohens_kappa(pairs) == pytest.approx(0.0)

    def test_none_on_insufficient_data(self):
        assert rho.cohens_kappa([]) is None
        assert rho.cohens_kappa([("pass", "pass")]) is None

    def test_none_when_marginals_are_perfect(self):
        # Both raters always say "pass" — expected = 1.0, κ undefined.
        pairs = [("pass", "pass"), ("pass", "pass"), ("pass", "pass")]
        assert rho.cohens_kappa(pairs) is None


class TestRun:
    def test_full_agreement_gives_no_disagreements(self):
        manifest = {
            "entries": [
                {"case_id": "1", "source_file": "a.json"},
                {"case_id": "2", "source_file": "a.json"},
            ]
        }
        corpus = {
            "a.json": {
                "1": {"human_verdict": "pass"},
                "2": {"human_verdict": "fail"},
            }
        }
        fake_engine = lambda case: rho.normalize_verdict(case["human_verdict"])
        report = rho.run(manifest, corpus, engine_fn=fake_engine)
        assert report["disagreements"] == []
        assert report["evaluated"] == 2
        assert report["agreement_rate"] == pytest.approx(1.0)

    def test_disagreement_is_reported(self):
        manifest = {
            "entries": [
                {"case_id": "1", "source_file": "a.json", "standard_id": "CLR-01"},
            ]
        }
        corpus = {"a.json": {"1": {"human_verdict": "pass"}}}
        fake_engine = lambda _case: "fail"
        report = rho.run(manifest, corpus, engine_fn=fake_engine)
        assert len(report["disagreements"]) == 1
        assert report["disagreements"][0]["human_verdict"] == "pass"
        assert report["disagreements"][0]["engine_verdict"] == "fail"

    def test_missing_source_case_reported_not_silent(self):
        manifest = {
            "entries": [
                {"case_id": "missing", "source_file": "a.json"},
            ]
        }
        corpus = {"a.json": {}}
        fake_engine = lambda _c: "pass"
        report = rho.run(manifest, corpus, engine_fn=fake_engine)
        # "Silent pass" is not a supported state — case must show up.
        assert len(report["missing_case"]) == 1
        assert report["evaluated"] == 0

    def test_engine_error_reported_separately(self):
        manifest = {
            "entries": [{"case_id": "1", "source_file": "a.json"}]
        }
        corpus = {"a.json": {"1": {"human_verdict": "pass"}}}
        fake_engine = lambda _c: None
        report = rho.run(manifest, corpus, engine_fn=fake_engine)
        assert len(report["engine_errors"]) == 1
        assert report["evaluated"] == 0
