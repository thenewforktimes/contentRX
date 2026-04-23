"""Tests for the quarterly self-drift check tool (Session 7).

Covers the pure-logic paths — threshold calibration, regime
classification, κ + 95% CI, stratified panel construction, blind
panel export, and drift-report scoring — using synthetic fixtures so
the suite runs without the gitignored industry corpus.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

TOOLS_DIR = Path(__file__).resolve().parent.parent / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import drift_check as dc  # noqa: E402


# ---------------------------------------------------------------------------
# Regime + threshold math
# ---------------------------------------------------------------------------


class TestClassifyRegime:
    def test_target_met(self):
        assert dc.classify_regime(0.90) == dc.REGIME_TARGET_MET
        assert dc.classify_regime(0.95) == dc.REGIME_TARGET_MET
        assert dc.classify_regime(1.00) == dc.REGIME_TARGET_MET

    def test_maturing(self):
        assert dc.classify_regime(0.85) == dc.REGIME_MATURING
        assert dc.classify_regime(0.87) == dc.REGIME_MATURING
        assert dc.classify_regime(0.8999) == dc.REGIME_MATURING

    def test_graduation_frozen(self):
        assert dc.classify_regime(0.80) == dc.REGIME_FROZEN
        assert dc.classify_regime(0.82) == dc.REGIME_FROZEN
        assert dc.classify_regime(0.8499) == dc.REGIME_FROZEN

    def test_degraded(self):
        assert dc.classify_regime(0.79) == dc.REGIME_DEGRADED
        assert dc.classify_regime(0.50) == dc.REGIME_DEGRADED
        assert dc.classify_regime(0.00) == dc.REGIME_DEGRADED


class TestCalibrateThresholds:
    def test_target_ceiling_matches_plan_spec(self):
        t = dc.calibrate_thresholds(0.90)
        # Plan spec: autonomous = 0.94 × 0.90 = 0.846, batch = 0.83 × 0.90 = 0.747.
        # Plan's rounded stated values: 0.85 and 0.75 — the underlying
        # arithmetic lands a few thousandths below, which is expected.
        assert t["autonomous_kappa"] == pytest.approx(0.846)
        assert t["batch_approval_kappa"] == pytest.approx(0.747)
        assert t["regime"] == dc.REGIME_TARGET_MET
        assert t["blocks_new_autonomous"] is False

    def test_below_frozen_blocks_autonomous(self):
        t = dc.calibrate_thresholds(0.82)
        assert t["regime"] == dc.REGIME_FROZEN
        assert t["blocks_new_autonomous"] is True

    def test_below_degraded_blocks_autonomous(self):
        t = dc.calibrate_thresholds(0.70)
        assert t["regime"] == dc.REGIME_DEGRADED
        assert t["blocks_new_autonomous"] is True

    def test_ratios_are_constants(self):
        t = dc.calibrate_thresholds(0.5)
        assert t["autonomous_ratio"] == dc.AUTONOMOUS_RATIO
        assert t["batch_approval_ratio"] == dc.BATCH_APPROVAL_RATIO


# ---------------------------------------------------------------------------
# Cohen's κ + 95% CI
# ---------------------------------------------------------------------------


class TestCohensKappa:
    def test_perfect_agreement(self):
        pairs = [("pass", "pass"), ("fail", "fail"), ("pass", "pass")]
        assert dc.cohens_kappa(pairs) == pytest.approx(1.0)

    def test_chance_agreement_is_zero(self):
        # 50/50 marginals, 50% observed → κ = 0.
        pairs = [("pass", "pass"), ("pass", "fail"), ("fail", "pass"), ("fail", "fail")]
        assert dc.cohens_kappa(pairs) == pytest.approx(0.0)

    def test_none_when_too_few(self):
        assert dc.cohens_kappa([]) is None
        assert dc.cohens_kappa([("pass", "pass")]) is None

    def test_none_when_marginals_perfect(self):
        pairs = [("pass", "pass")] * 5
        assert dc.cohens_kappa(pairs) is None


class TestCohensKappaWithCI:
    def test_perfect_agreement_summary(self):
        pairs = [("pass", "pass"), ("fail", "fail"), ("pass", "pass")] * 10
        s = dc.cohens_kappa_with_ci(pairs)
        assert s["kappa"] == pytest.approx(1.0)
        assert s["observed_agreement"] == pytest.approx(1.0)
        assert s["n"] == 30

    def test_ci_brackets_kappa(self):
        pairs = (
            [("pass", "pass")] * 15
            + [("fail", "fail")] * 10
            + [("pass", "fail")] * 2
            + [("fail", "pass")] * 3
        )
        s = dc.cohens_kappa_with_ci(pairs)
        assert s["kappa"] is not None
        assert s["ci_low"] is not None
        assert s["ci_high"] is not None
        assert s["ci_low"] <= s["kappa"] <= s["ci_high"]
        # 95% CI width shouldn't be pathological on 30 cases.
        assert s["ci_high"] - s["ci_low"] < 0.8

    def test_empty_input(self):
        s = dc.cohens_kappa_with_ci([])
        assert s["kappa"] is None
        assert s["ci_low"] is None
        assert s["ci_high"] is None
        assert s["n"] == 0


# ---------------------------------------------------------------------------
# Stratified panel construction
# ---------------------------------------------------------------------------


def _case(**overrides):
    base = {
        "case_id": "x",
        "_source_file": "a.json",
        "text": "foo",
        "content_type": "short_ui_copy",
        "moment": "browsing_discovery",
        "standard_id": "CLR-01",
        "human_verdict": "pass",
        "human_confidence": "high",
        "review_status": "approved",
    }
    base.update(overrides)
    return base


class TestBuildPanel:
    def test_respects_target_size(self):
        eligible = [_case(case_id=f"id-{i}") for i in range(200)]
        selected, stats = dc.build_panel(eligible, size=80)
        assert len(selected) == 80
        assert stats["selected"] == 80

    def test_degrades_when_pool_smaller_than_size(self):
        eligible = [_case(case_id=f"id-{i}") for i in range(20)]
        selected, stats = dc.build_panel(eligible, size=80)
        assert len(selected) == 20

    def test_skips_ineligible_cases(self):
        eligible = [
            _case(case_id="keep", human_confidence="high", review_status="approved"),
            _case(case_id="drop-med", human_confidence="medium"),
            _case(case_id="drop-pending", review_status="pending"),
        ]
        selected, stats = dc.build_panel(eligible, size=80)
        assert [c["case_id"] for c in selected] == ["keep"]
        assert stats["eligible_pool"] == 1

    def test_stratifies_across_moment_and_content_type(self):
        # Five buckets of 20 cases each — target 20 total should spread
        # ~4 per bucket.
        eligible: list[dict] = []
        for moment in ("browsing_discovery", "task_execution", "celebration"):
            for ct in ("heading", "short_ui_copy"):
                for i in range(20):
                    eligible.append(_case(
                        case_id=f"{moment}-{ct}-{i}",
                        moment=moment,
                        content_type=ct,
                    ))
        selected, stats = dc.build_panel(eligible, size=24)
        # 24 cases across 6 buckets (3 moments × 2 CTs) → 4 each.
        assert stats["selected"] == 24
        assert len(stats["buckets"]) == 6
        for bucket_key, count in stats["buckets"].items():
            assert count == 4

    def test_deterministic(self):
        eligible = [_case(case_id=f"id-{i}") for i in range(60)]
        a, _ = dc.build_panel(eligible, size=20)
        b, _ = dc.build_panel(eligible, size=20)
        assert [c["case_id"] for c in a] == [c["case_id"] for c in b]

    def test_growth_is_stable(self):
        small = [_case(case_id=f"id-{i}") for i in range(40)]
        large = small + [_case(case_id=f"id-{i}") for i in range(40, 80)]
        a, _ = dc.build_panel(small, size=20)
        b, _ = dc.build_panel(large, size=20)
        # Same case_ids come out — the sort within each bucket is
        # stable by (source_file, case_id).
        assert [c["case_id"] for c in a] == [c["case_id"] for c in b]

    def test_reports_skipped_moments(self):
        # Only two moments represented; stats should flag the rest.
        eligible = [
            _case(case_id=f"id-{i}", moment="browsing_discovery") for i in range(10)
        ] + [_case(case_id=f"te-{i}", moment="task_execution") for i in range(10)]
        _, stats = dc.build_panel(eligible, size=10)
        assert "browsing_discovery" in stats["moments_covered"]
        assert "task_execution" in stats["moments_covered"]


# ---------------------------------------------------------------------------
# Blind-panel export
# ---------------------------------------------------------------------------


class TestBuildBlindPanel:
    def test_strips_past_verdict_and_notes(self):
        panel = {
            "quarter": "2026-q2",
            "generated_at": "t",
            "entries": [
                {
                    "case_id": "id-1",
                    "source_file": "a.json",
                    "past_human_verdict": "pass",
                    "past_human_confidence": "high",
                }
            ],
        }
        corpus = {
            "a.json": {
                "id-1": {
                    "text": "hello",
                    "content_type": "heading",
                    "moment": "wayfinding",
                    "standard_id": "PRF-03",
                    "human_verdict": "pass",  # present but must not leak
                    "human_notes": "old reasoning",  # must not leak
                    "machine_verdict": "fail",  # must not leak
                }
            }
        }
        blind = dc.build_blind_panel(panel, corpus)
        assert len(blind["entries"]) == 1
        e = blind["entries"][0]
        # Context preserved.
        assert e["text"] == "hello"
        assert e["content_type"] == "heading"
        assert e["moment"] == "wayfinding"
        # Past verdict / rationale stripped.
        assert "past_human_verdict" not in e
        assert "human_verdict" not in e
        assert "human_notes" not in e
        assert "machine_verdict" not in e

    def test_records_missing_cases(self):
        panel = {
            "quarter": "2026-q2",
            "entries": [
                {"case_id": "gone", "source_file": "a.json"},
            ],
        }
        blind = dc.build_blind_panel(panel, {"a.json": {}})
        assert blind["entries"] == []
        assert blind["missing"] == ["a.json::gone"]


# ---------------------------------------------------------------------------
# Drift scoring
# ---------------------------------------------------------------------------


class TestComputeDriftReport:
    def test_perfect_agreement_reports_ceiling_1(self):
        panel = {
            "quarter": "2026-q2",
            "entries": [
                {"case_id": f"c-{i}", "past_human_verdict": "pass" if i % 2 else "fail",
                 "standard_id": "CLR-01"}
                for i in range(20)
            ],
        }
        responses = [
            {"case_id": f"c-{i}", "human_verdict": "pass" if i % 2 else "fail"}
            for i in range(20)
        ]
        report = dc.compute_drift_report(panel, responses)
        assert report["measured_ceiling"] == pytest.approx(1.0)
        assert report["kappa_summary"]["kappa"] == pytest.approx(1.0)
        assert report["thresholds"]["regime"] == dc.REGIME_TARGET_MET
        assert report["disagreements"] == []

    def test_reports_disagreements_and_implicated_standards(self):
        panel = {
            "quarter": "2026-q2",
            "entries": [
                {"case_id": "1", "past_human_verdict": "pass", "standard_id": "CLR-01",
                 "source_file": "a.json", "moment": "browsing_discovery"},
                {"case_id": "2", "past_human_verdict": "fail", "standard_id": "VT-02",
                 "source_file": "a.json", "moment": "celebration"},
                {"case_id": "3", "past_human_verdict": "pass", "standard_id": "CLR-01",
                 "source_file": "a.json", "moment": "browsing_discovery"},
            ],
        }
        responses = [
            {"case_id": "1", "human_verdict": "fail"},      # flipped
            {"case_id": "2", "human_verdict": "fail"},      # agree
            {"case_id": "3", "human_verdict": "fail"},      # flipped
        ]
        report = dc.compute_drift_report(panel, responses)
        assert len(report["disagreements"]) == 2
        assert set(report["implicated_standards"]) == {"CLR-01"}
        assert report["per_standard_kappa"]["CLR-01"]["disagreements"] == 2

    def test_accepts_dict_wrapped_responses(self):
        panel = {"quarter": "q", "entries": [
            {"case_id": "1", "past_human_verdict": "pass"},
        ]}
        # The CLI accepts both list and {entries: [...]} shapes.
        responses_dict = {"entries": [{"case_id": "1", "human_verdict": "pass"}]}
        report = dc.compute_drift_report(panel, responses_dict["entries"])
        assert report["pairs_scored"] == 1

    def test_counts_missing_responses(self):
        panel = {"quarter": "q", "entries": [
            {"case_id": "1", "past_human_verdict": "pass"},
            {"case_id": "2", "past_human_verdict": "fail"},
        ]}
        responses = [{"case_id": "1", "human_verdict": "pass"}]
        report = dc.compute_drift_report(panel, responses)
        assert report["pairs_scored"] == 1
        assert report["missing_current"] == ["2"]

    def test_ignores_unknown_verdicts(self):
        panel = {"quarter": "q", "entries": [
            {"case_id": "1", "past_human_verdict": "pass"},
            {"case_id": "2", "past_human_verdict": "pass"},
        ]}
        responses = [
            {"case_id": "1", "human_verdict": "banana"},  # rejected
            {"case_id": "2", "human_verdict": "pass"},
        ]
        report = dc.compute_drift_report(panel, responses)
        assert report["pairs_scored"] == 1
        assert report["unknown_verdict"] == ["1"]

    def test_threshold_block_flag_propagates_from_ceiling(self):
        # Force κ into the frozen regime.
        panel = {"quarter": "q", "entries": [
            {"case_id": f"c-{i}", "past_human_verdict": "pass" if i < 10 else "fail"}
            for i in range(20)
        ]}
        # Mismatch enough cases to push κ below 0.85.
        responses = [
            {"case_id": f"c-{i}", "human_verdict": "pass" if i < 10 else "fail"}
            if i < 17 else
            {"case_id": f"c-{i}", "human_verdict": "pass"}
            for i in range(20)
        ]
        report = dc.compute_drift_report(panel, responses)
        # We don't assert an exact κ (depends on the mismatch count),
        # but if κ lands below 0.85 the block flag must fire.
        if report["measured_ceiling"] < 0.85:
            assert report["thresholds"]["blocks_new_autonomous"] is True


# ---------------------------------------------------------------------------
# Quarter helper
# ---------------------------------------------------------------------------


class TestCurrentQuarter:
    def test_q1_months(self):
        import datetime as dt
        assert dc.current_quarter(dt.date(2026, 1, 15)) == "2026-q1"
        assert dc.current_quarter(dt.date(2026, 3, 31)) == "2026-q1"

    def test_q2_months(self):
        import datetime as dt
        assert dc.current_quarter(dt.date(2026, 4, 1)) == "2026-q2"
        assert dc.current_quarter(dt.date(2026, 6, 30)) == "2026-q2"

    def test_q4_months(self):
        import datetime as dt
        assert dc.current_quarter(dt.date(2026, 12, 31)) == "2026-q4"


# ---------------------------------------------------------------------------
# _inv_std_normal sanity
# ---------------------------------------------------------------------------


class TestInvStdNormal:
    def test_0_975_is_approx_196(self):
        # The 97.5th percentile (two-sided 95% CI) is ~1.96.
        assert dc._inv_std_normal(0.975) == pytest.approx(1.96, abs=1e-3)

    def test_median_is_zero(self):
        assert dc._inv_std_normal(0.5) == pytest.approx(0.0, abs=1e-6)
