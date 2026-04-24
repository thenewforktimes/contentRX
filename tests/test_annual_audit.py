"""Tests for the annual taxonomy audit (Session 36).

Pins the age-filter invariant + the scoring rollups (per-standard +
per-moment disagreement, retired-standard detection, new-moment
surfacing, ceiling-recommendation text).
"""

from __future__ import annotations

import datetime as _dt
import json

from tools.annual_audit_sample import (
    DEFAULT_MIN_AGE_DAYS,
    DEFAULT_PANEL_SIZE,
    filter_eligible_and_aged,
    is_older_than_days,
)
from tools.annual_audit_score import (
    AUDIT_BAND_STABLE,
    AUDIT_BAND_WATCH,
    DESIGN_TARGET_KAPPA,
    build_report,
    ceiling_recommendation,
    classify_audit_band,
    render_markdown,
)

TODAY = _dt.date(2026, 4, 24)


# ---------------------------------------------------------------------------
# is_older_than_days / filter_eligible_and_aged
# ---------------------------------------------------------------------------


def test_older_than_days_true_above_threshold():
    case = {"evaluated_at": "2024-01-01"}
    assert is_older_than_days(case, min_age_days=365, today=TODAY)


def test_older_than_days_false_below_threshold():
    # 300 days ago is inside the 365 window → not older_than.
    case = {"evaluated_at": (TODAY - _dt.timedelta(days=300)).isoformat()}
    assert not is_older_than_days(case, min_age_days=365, today=TODAY)


def test_older_than_days_accepts_iso_datetime_with_timezone():
    case = {"created_at": "2024-01-01T12:34:56Z"}
    assert is_older_than_days(case, min_age_days=365, today=TODAY)


def test_older_than_days_missing_timestamp_is_false():
    """Cases without a timestamp aren't assumed old — positive evidence
    of age is required."""
    assert not is_older_than_days({}, min_age_days=365, today=TODAY)


def test_older_than_days_unparseable_timestamp_is_false():
    assert not is_older_than_days(
        {"evaluated_at": "last Tuesday"},
        min_age_days=365,
        today=TODAY,
    )


def test_filter_eligible_and_aged_requires_both_conditions():
    cases = [
        # Eligible AND old → kept.
        {
            "case_id": "keep",
            "evaluated_at": "2024-01-01",
            "human_confidence": "high",
            "review_status": "approved",
        },
        # Eligible BUT recent → dropped.
        {
            "case_id": "recent",
            "evaluated_at": (TODAY - _dt.timedelta(days=30)).isoformat(),
            "human_confidence": "high",
            "review_status": "approved",
        },
        # Old BUT ineligible → dropped.
        {
            "case_id": "low_confidence",
            "evaluated_at": "2024-01-01",
            "human_confidence": "low",
            "review_status": "approved",
        },
    ]
    kept = filter_eligible_and_aged(cases, min_age_days=365, today=TODAY)
    assert [c["case_id"] for c in kept] == ["keep"]


def test_defaults_reflect_plan_spec():
    # Plan-locked: 100 cases, 1 year.
    assert DEFAULT_PANEL_SIZE == 100
    assert DEFAULT_MIN_AGE_DAYS == 365


# ---------------------------------------------------------------------------
# classify_audit_band / ceiling_recommendation
# ---------------------------------------------------------------------------


def test_classify_audit_band_stable_watch_material_drift_none():
    assert classify_audit_band(0.85) == "stable"
    assert classify_audit_band(AUDIT_BAND_STABLE) == "stable"
    assert classify_audit_band(0.70) == "watch"
    assert classify_audit_band(AUDIT_BAND_WATCH) == "watch"
    assert classify_audit_band(0.30) == "material_drift"
    assert classify_audit_band(None) == "insufficient_data"


def test_ceiling_recommendation_above_target_keeps_ceiling():
    text = ceiling_recommendation(0.92, 0.95)
    assert "keep the ceiling" in text.lower()


def test_ceiling_recommendation_ci_covers_target_stays_cautious():
    text = ceiling_recommendation(0.85, 0.91)
    assert "defensible but tight" in text.lower()


def test_ceiling_recommendation_below_and_ci_excludes_target_recommends_lowering():
    text = ceiling_recommendation(0.70, 0.80)
    assert "below the 0.90 design target" in text.lower()
    assert "thresholds move with the measurement" in text.lower()


def test_ceiling_recommendation_insufficient_data_is_explicit():
    text = ceiling_recommendation(None, None)
    assert "insufficient scored pairs" in text.lower()


# ---------------------------------------------------------------------------
# build_report end-to-end
# ---------------------------------------------------------------------------


def _panel(entries):
    return {"year": 2026, "entries": entries}


def test_build_report_counts_scored_pairs_and_agreement():
    panel = _panel(
        [
            {
                "case_id": "c1",
                "standard_id": "CLR-01",
                "moment": "browsing_discovery",
                "past_human_verdict": "pass",
            },
            {
                "case_id": "c2",
                "standard_id": "CLR-01",
                "moment": "browsing_discovery",
                "past_human_verdict": "violation",
            },
            {
                "case_id": "c3",
                "standard_id": "VT-05",
                "moment": "error_recovery",
                "past_human_verdict": "violation",
            },
        ]
    )
    labels = {"c1": "pass", "c2": "violation", "c3": "pass"}
    report = build_report(
        panel,
        labels,
        current_library_standards={"CLR-01", "VT-05"},
        current_library_moments={"browsing_discovery", "error_recovery"},
        now_iso="2026-04-24T12:00:00Z",
    )
    assert report.panel_size == 3
    assert report.scored_pairs == 3
    # 2 of 3 agree.
    assert abs(report.overall_agreement - 2 / 3) < 1e-6
    # Per-standard: VT-05 has 1 case, 1 disagreement; CLR-01 has 2, 0 disagreements.
    by_id = {s.standard_id: s for s in report.per_standard}
    assert by_id["VT-05"].disagreements == 1
    assert by_id["CLR-01"].disagreements == 0


def test_build_report_skips_entries_missing_past_or_current_verdict():
    panel = _panel(
        [
            {"case_id": "scored", "standard_id": "CLR-01", "past_human_verdict": "pass"},
            {"case_id": "missing_current", "standard_id": "CLR-01", "past_human_verdict": "pass"},
            {"case_id": "missing_past", "standard_id": "CLR-01"},
        ]
    )
    labels = {"scored": "pass"}  # "missing_current" not re-labeled
    report = build_report(
        panel,
        labels,
        current_library_standards={"CLR-01"},
        current_library_moments=set(),
        now_iso="2026-04-24T12:00:00Z",
    )
    assert report.panel_size == 3
    assert report.scored_pairs == 1


def test_build_report_surfaces_retired_standard_candidates():
    panel = _panel(
        [
            {"case_id": "c1", "standard_id": "PRF-OLD", "past_human_verdict": "violation"},
            {"case_id": "c2", "standard_id": "CLR-01", "past_human_verdict": "pass"},
        ]
    )
    labels = {"c1": "violation", "c2": "pass"}
    report = build_report(
        panel,
        labels,
        current_library_standards={"CLR-01"},  # PRF-OLD retired
        current_library_moments=set(),
        now_iso="2026-04-24T12:00:00Z",
    )
    assert "PRF-OLD" in report.retired_standard_candidates
    assert "CLR-01" not in report.retired_standard_candidates


def test_build_report_flags_new_moment_candidates():
    panel = _panel(
        [
            {
                "case_id": "c1",
                "standard_id": "CLR-01",
                "moment": "dropped_moment",
                "past_human_verdict": "pass",
            },
            {
                "case_id": "c2",
                "standard_id": "CLR-01",
                "moment": "browsing_discovery",
                "past_human_verdict": "pass",
            },
        ]
    )
    labels = {"c1": "pass", "c2": "pass"}
    report = build_report(
        panel,
        labels,
        current_library_standards={"CLR-01"},
        current_library_moments={"browsing_discovery"},
        now_iso="2026-04-24T12:00:00Z",
    )
    candidates = {c["case_id"] for c in report.new_moment_candidates}
    assert "c1" in candidates
    assert "c2" not in candidates


def test_build_report_sorts_per_standard_by_disagreement_rate_desc():
    # Two pairs each for two standards. One disagrees twice, the other once.
    panel = _panel(
        [
            {"case_id": "a1", "standard_id": "STD-HIGH", "past_human_verdict": "pass"},
            {"case_id": "a2", "standard_id": "STD-HIGH", "past_human_verdict": "pass"},
            {"case_id": "b1", "standard_id": "STD-LOW", "past_human_verdict": "pass"},
            {"case_id": "b2", "standard_id": "STD-LOW", "past_human_verdict": "pass"},
        ]
    )
    labels = {
        "a1": "violation",
        "a2": "violation",  # STD-HIGH: 100% disagreement
        "b1": "pass",
        "b2": "violation",  # STD-LOW: 50% disagreement
    }
    report = build_report(
        panel,
        labels,
        current_library_standards={"STD-HIGH", "STD-LOW"},
        current_library_moments=set(),
        now_iso="2026-04-24T12:00:00Z",
    )
    assert [s.standard_id for s in report.per_standard] == ["STD-HIGH", "STD-LOW"]


# ---------------------------------------------------------------------------
# Markdown rendering
# ---------------------------------------------------------------------------


def test_render_markdown_includes_every_plan_spec_section():
    panel = _panel(
        [
            {"case_id": "c1", "standard_id": "CLR-01", "moment": "browsing_discovery", "past_human_verdict": "pass"},
        ]
    )
    labels = {"c1": "violation"}
    report = build_report(
        panel,
        labels,
        current_library_standards={"CLR-01"},
        current_library_moments={"browsing_discovery"},
        now_iso="2026-04-24T12:00:00Z",
    )
    md = render_markdown(report)
    for section in [
        "# Annual taxonomy audit",
        "## Top line",
        "## Ceiling recommendation",
        "## Standards with highest past/present disagreement",
        "## Moments with most evolution",
        "## Retired standards that might deserve reinstatement",
        "## New-moment candidates",
        "## Next year's taxonomy roadmap",
    ]:
        assert section in md, f"missing section: {section!r}"


def test_render_markdown_reports_design_target_explicitly():
    panel = _panel([
        {"case_id": "c1", "standard_id": "CLR-01", "past_human_verdict": "pass"},
    ])
    labels = {"c1": "pass"}
    report = build_report(
        panel,
        labels,
        current_library_standards={"CLR-01"},
        current_library_moments=set(),
        now_iso="2026-04-24T12:00:00Z",
    )
    md = render_markdown(report)
    assert f"Design target: κ = {DESIGN_TARGET_KAPPA}" in md


def test_report_to_dict_is_json_serialisable():
    panel = _panel([
        {"case_id": "c1", "standard_id": "CLR-01", "past_human_verdict": "pass"},
    ])
    report = build_report(
        panel,
        {"c1": "pass"},
        current_library_standards={"CLR-01"},
        current_library_moments=set(),
        now_iso="2026-04-24T12:00:00Z",
    )
    # Round-trip through JSON to catch non-serialisable surprises.
    data = json.loads(json.dumps(report.to_dict()))
    assert data["year"] == 2026
    assert "audit_band" in data
    assert data["design_target_kappa"] == DESIGN_TARGET_KAPPA
