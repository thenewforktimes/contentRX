"""Tests for the weekly calibration log generator."""

from __future__ import annotations

import importlib.util
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parent.parent
_GENERATOR_PATH = _REPO_ROOT / "reports" / "calibration" / "generate.py"

_spec = importlib.util.spec_from_file_location(
    "_calibration_generator", _GENERATOR_PATH
)
assert _spec and _spec.loader
calibration_generator = importlib.util.module_from_spec(_spec)
sys.modules["_calibration_generator"] = calibration_generator
_spec.loader.exec_module(calibration_generator)


FIXED_NOW = datetime(2026, 4, 27, 14, 0, 0, tzinfo=timezone.utc)  # Monday


def _accuracy_measured() -> dict:
    return {
        "schema_version": "1.0.0",
        "generated_at": "2026-04-27T03:00:00Z",
        "measured_system": {
            "state": "measured",
            "value": 0.872,
            "ci_low": 0.851,
            "ci_high": 0.893,
            "sample_size": 1234,
        },
        "measured_self_drift": {
            "state": "measured",
            "value": 0.91,
            "ci_low": 0.886,
            "ci_high": 0.934,
            "sample_size": 200,
        },
        "design_target": 0.9,
        "by_level": {"robo_labels": 41, "batch_approval": 4, "autonomous": 2},
        "standards_measured": 6,
        "standards_total": 47,
    }


def _accuracy_pending() -> dict:
    return {
        "schema_version": "1.0.0",
        "generated_at": "2026-04-27T03:00:00Z",
        "measured_system": {
            "state": "pending_measurement",
            "reason": "no standards have completed the weekly κ series",
        },
        "measured_self_drift": {
            "state": "pending_measurement",
            "reason": "Session 7 drift panel awaiting blind re-label + score",
        },
        "design_target": 0.9,
        "by_level": {"robo_labels": 43, "batch_approval": 0, "autonomous": 0},
        "standards_measured": 0,
        "standards_total": 47,
    }


REFINEMENT_LOG_FIXTURE = """# Taxonomy refinement log

Some preface.

## Open refinements

### REF-001: ui_label split

**Current category:** ui_label

### REF-002: another open candidate

**Current category:** error_message

## Proposed refinements (auto-detected)

### REF-A001: data_viz_label

**Current category:** ui_label

## Approved refinements

### REF-099: should not appear

**Current category:** error_message

## Declined refinements

### REF-098: also should not appear
"""


class TestIsoWeek:
    def test_iso_week_format(self):
        out = calibration_generator.iso_week(FIXED_NOW)
        # 2026-04-27 is in ISO week 18 of 2026.
        assert out.startswith("2026-")
        assert len(out) == 7  # YYYY-WW
        assert int(out.split("-")[1]) >= 1


class TestBuilderShape:
    def test_pending_path_handles_missing_inputs(self):
        log = calibration_generator.build_calibration_log(
            accuracy=None,
            prior_accuracy=None,
            refinement_log_md="",
            week="2026-18",
            now=FIXED_NOW,
        )
        assert log.week == "2026-18"
        assert log.measured_system is None
        assert log.kappa_delta_pp is None
        assert log.standards_measured == 0
        assert log.active_refinements_count == 0

    def test_measured_path_carries_kappa(self):
        log = calibration_generator.build_calibration_log(
            accuracy=_accuracy_measured(),
            prior_accuracy=None,
            refinement_log_md="",
            week="2026-18",
            now=FIXED_NOW,
        )
        assert log.measured_system is not None
        assert log.measured_system["value"] == pytest.approx(0.872)
        assert log.measured_system["sample_size"] == 1234

    def test_kappa_delta_pp_when_both_sides_measured(self):
        prior = _accuracy_measured()
        prior["measured_system"]["value"] = 0.860  # +1.2 pp this week
        log = calibration_generator.build_calibration_log(
            accuracy=_accuracy_measured(),
            prior_accuracy=prior,
            refinement_log_md="",
            week="2026-18",
            now=FIXED_NOW,
        )
        assert log.kappa_delta_pp == pytest.approx(1.2, abs=0.05)

    def test_kappa_delta_pp_negative_when_dropped(self):
        prior = _accuracy_measured()
        prior["measured_system"]["value"] = 0.880
        log = calibration_generator.build_calibration_log(
            accuracy=_accuracy_measured(),  # 0.872 < prior 0.880
            prior_accuracy=prior,
            refinement_log_md="",
            week="2026-18",
            now=FIXED_NOW,
        )
        assert log.kappa_delta_pp == pytest.approx(-0.8, abs=0.05)

    def test_kappa_delta_pp_none_when_pending(self):
        log = calibration_generator.build_calibration_log(
            accuracy=_accuracy_pending(),
            prior_accuracy=_accuracy_measured(),
            refinement_log_md="",
            week="2026-18",
            now=FIXED_NOW,
        )
        assert log.kappa_delta_pp is None


class TestRefinements:
    def test_active_refinements_excludes_approved_and_declined(self):
        log = calibration_generator.build_calibration_log(
            accuracy=None,
            prior_accuracy=None,
            refinement_log_md=REFINEMENT_LOG_FIXTURE,
            week="2026-18",
            now=FIXED_NOW,
        )
        # Open + auto_detected only — REF-099 (approved) and REF-098
        # (declined) MUST NOT appear.
        assert log.active_refinements_count == 3
        joined = " | ".join(log.active_refinements_top3)
        assert "REF-001" in joined
        assert "REF-002" in joined
        assert "REF-A001" in joined
        assert "REF-099" not in joined
        assert "REF-098" not in joined

    def test_active_refinements_caps_at_three(self):
        md = REFINEMENT_LOG_FIXTURE + "\n### REF-003: fourth\n\n### REF-004: fifth\n"
        log = calibration_generator.build_calibration_log(
            accuracy=None,
            prior_accuracy=None,
            refinement_log_md=md,
            week="2026-18",
            now=FIXED_NOW,
        )
        assert log.active_refinements_count >= 3
        assert len(log.active_refinements_top3) == 3


class TestMarkdownRender:
    def test_renders_week_in_h1(self):
        log = calibration_generator.build_calibration_log(
            accuracy=_accuracy_measured(),
            prior_accuracy=None,
            refinement_log_md=REFINEMENT_LOG_FIXTURE,
            week="2026-18",
            now=FIXED_NOW,
        )
        md = calibration_generator.render_markdown(log)
        assert md.startswith("# Calibration log — 2026-18")

    def test_renders_kappa_with_ci(self):
        log = calibration_generator.build_calibration_log(
            accuracy=_accuracy_measured(),
            prior_accuracy=None,
            refinement_log_md="",
            week="2026-18",
            now=FIXED_NOW,
        )
        md = calibration_generator.render_markdown(log)
        assert "0.872" in md
        assert "[0.851, 0.893]" in md
        assert "n = 1234" in md

    def test_renders_pending_state_honestly(self):
        log = calibration_generator.build_calibration_log(
            accuracy=_accuracy_pending(),
            prior_accuracy=None,
            refinement_log_md="",
            week="2026-18",
            now=FIXED_NOW,
        )
        md = calibration_generator.render_markdown(log)
        # Never coerce to 0 or to the design target.
        assert "0.000" not in md
        assert "Pending" in md or "pending" in md
        # by_level still renders
        assert "43 robo_labels" in md

    def test_does_not_leak_substrate_field_names(self):
        log = calibration_generator.build_calibration_log(
            accuracy=_accuracy_measured(),
            prior_accuracy=None,
            refinement_log_md=REFINEMENT_LOG_FIXTURE,
            week="2026-18",
            now=FIXED_NOW,
        )
        md = calibration_generator.render_markdown(log)
        # The calibration log is published. It can name graduation
        # tier counts (anonymised) but must NOT name any standard_id.
        # Refinement-log entries (REF-NNN) ARE intentionally surfaced;
        # they're a public marker, not a taxonomy ID.
        forbidden = ("CLR-01", "GRM-06", "rationale_chain", "rule_version")
        for f in forbidden:
            assert f not in md, f"{f!r} leaked into the published calibration log"

    def test_renders_refinement_top3(self):
        log = calibration_generator.build_calibration_log(
            accuracy=_accuracy_measured(),
            prior_accuracy=None,
            refinement_log_md=REFINEMENT_LOG_FIXTURE,
            week="2026-18",
            now=FIXED_NOW,
        )
        md = calibration_generator.render_markdown(log)
        assert "REF-001" in md
        assert "REF-002" in md
        assert "REF-A001" in md

    def test_drift_pending_message(self):
        log = calibration_generator.build_calibration_log(
            accuracy=_accuracy_pending(),
            prior_accuracy=None,
            refinement_log_md="",
            week="2026-18",
            now=FIXED_NOW,
        )
        md = calibration_generator.render_markdown(log)
        assert "Self-drift" in md
        assert "pending" in md.lower()

    def test_drift_measured_renders_value(self):
        log = calibration_generator.build_calibration_log(
            accuracy=_accuracy_measured(),
            prior_accuracy=None,
            refinement_log_md="",
            week="2026-18",
            now=FIXED_NOW,
        )
        md = calibration_generator.render_markdown(log)
        assert "Self-drift" in md
        assert "0.910" in md


class TestNoInternalVocabularyLeaks:
    """The calibration log is rendered publicly at /calibration/[week].
    ADR 2026-04-25 (private taxonomy) and docs/copy-vocabulary.md
    reserve internal architecture terms ("substrate") and internal
    routes (`/admin/*`) for the founder-side surfaces only. The
    generated markdown must not leak either onto the public page.

    A real instance of this leak shipped 2026-05-07: the override-
    stream pending line read "Override-by-subtype rollups land once
    the substrate API exposes them. Until then refer to
    `/admin/queue` for the live count." This test class is the
    anti-regression."""

    def _all_render_paths(self) -> list[str]:
        # Exercise both code paths (pending + measured) so the test
        # catches a leak introduced in either branch.
        markdowns: list[str] = []
        for accuracy in (_accuracy_pending(), _accuracy_measured()):
            log = calibration_generator.build_calibration_log(
                accuracy=accuracy,
                prior_accuracy=None,
                refinement_log_md="",
                week="2026-18",
                now=FIXED_NOW,
            )
            markdowns.append(calibration_generator.render_markdown(log))
        return markdowns

    def test_no_substrate_term_in_rendered_markdown(self):
        for md in self._all_render_paths():
            assert "substrate" not in md.lower(), (
                "internal architecture term 'substrate' leaked into "
                "the public calibration log"
            )

    def test_no_admin_routes_in_rendered_markdown(self):
        for md in self._all_render_paths():
            assert "/admin/" not in md, (
                "founder-only route '/admin/...' leaked into the "
                "public calibration log"
            )

    def test_override_stream_section_renders_customer_safe_pending(self):
        log = calibration_generator.build_calibration_log(
            accuracy=_accuracy_measured(),
            prior_accuracy=None,
            refinement_log_md="",
            week="2026-18",
            now=FIXED_NOW,
        )
        md = calibration_generator.render_markdown(log)
        # Section header is preserved (consistency-of-format rule).
        assert "## Override stream" in md
        # Pending line is plain language about future state, not
        # internal architecture.
        assert "No override data this week" in md
