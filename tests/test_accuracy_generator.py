"""Tests for the public accuracy snapshot generator.

Exercises the pure `build_snapshot()` function with structured inputs
and asserts the public-safe shape: only the load-bearing numbers,
no per-standard substrate, no standard_id leakage.
"""

from __future__ import annotations

import importlib.util
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

# The generator script lives outside any Python package
# (`reports/accuracy/generate.py` — the report tree mirrors the docs
# site's URL structure). Load it via importlib so tests can call
# `build_snapshot` directly without restructuring the file layout.
_THIS_FILE = Path(__file__).resolve()
_REPO_ROOT = _THIS_FILE.parent.parent
_GENERATOR_PATH = _REPO_ROOT / "reports" / "accuracy" / "generate.py"

_spec = importlib.util.spec_from_file_location(
    "_accuracy_generator", _GENERATOR_PATH
)
assert _spec and _spec.loader
accuracy_generator = importlib.util.module_from_spec(_spec)
sys.modules["_accuracy_generator"] = accuracy_generator
_spec.loader.exec_module(accuracy_generator)


FIXED_NOW = datetime(2026, 4, 25, 18, 0, 0, tzinfo=timezone.utc)


def _readiness_with_two_measured() -> dict:
    """A minimal readiness.json shape with two measured standards."""
    return {
        "schema_version": "1.0.0",
        "generated_at": "2026-04-24T00:00:00Z",
        "measured_ceiling": {"value": 0.91, "ci_low": 0.886, "ci_high": 0.934},
        "autonomous_kappa_threshold": 0.846,
        "batch_approval_kappa_threshold": 0.747,
        "standards_evaluated": 47,
        "by_level": {
            "robo_labels": 41,
            "batch_approval": 4,
            "autonomous": 2,
        },
        "standards": [
            {
                "standard_id": "CLR-01",
                "recommended_level": "autonomous",
                "autonomous": {
                    "sample": {"size": 600},
                    "criteria": {
                        "kappa": {
                            "value": 0.92,
                            "ci_low": 0.90,
                            "ci_high": 0.94,
                        }
                    },
                },
            },
            {
                "standard_id": "GRM-06",
                "recommended_level": "batch_approval",
                "batch_approval": {
                    "sample": {"size": 200},
                    "criteria": {
                        "kappa": {
                            "value": 0.84,
                            "ci_low": 0.80,
                            "ci_high": 0.88,
                        }
                    },
                },
            },
        ],
    }


def _drift() -> dict:
    return {
        "kappa": 0.91,
        "kappa_ci_low": 0.886,
        "kappa_ci_high": 0.934,
        "sample_size": 200,
    }


class TestSnapshotShape:
    def test_locks_schema_version(self):
        snap = accuracy_generator.build_snapshot(
            readiness=None, drift=None, now=FIXED_NOW
        )
        assert snap.schema_version == "1.0.0"
        assert snap.design_target == 0.9

    def test_top_level_fields_only(self):
        snap = accuracy_generator.build_snapshot(
            readiness=_readiness_with_two_measured(),
            drift=_drift(),
            now=FIXED_NOW,
        )
        d = snap.__dict__
        # Public envelope contains exactly these keys — no
        # per-standard, no standards array, no standard_ids anywhere.
        assert set(d.keys()) == {
            "schema_version",
            "generated_at",
            "measured_system",
            "measured_self_drift",
            "design_target",
            "by_level",
            "standards_measured",
            "standards_total",
        }

    def test_does_not_leak_standard_id(self):
        snap = accuracy_generator.build_snapshot(
            readiness=_readiness_with_two_measured(),
            drift=_drift(),
            now=FIXED_NOW,
        )
        # Serialise + scan — defense-in-depth against future fields
        # that might smuggle substrate through.
        import json
        blob = json.dumps(snap.__dict__)
        forbidden_patterns = (
            "CLR-01", "GRM-06", "standard_id", "rule_version",
            "rationale_chain", "related_standards",
        )
        for pat in forbidden_patterns:
            assert pat not in blob, f"{pat!r} leaked into public snapshot"

    def test_does_not_leak_moment_names(self):
        # Even when readiness has moment-keyed substrate, the snapshot
        # never carries it. Today's readiness.json doesn't include
        # moment fields per-standard, but make the test future-proof.
        readiness = _readiness_with_two_measured()
        readiness["standards"][0]["moment"] = "destructive_action"
        snap = accuracy_generator.build_snapshot(
            readiness=readiness, drift=_drift(), now=FIXED_NOW
        )
        import json
        assert "destructive_action" not in json.dumps(snap.__dict__)


class TestSystemKappa:
    def test_pending_when_readiness_missing(self):
        snap = accuracy_generator.build_snapshot(
            readiness=None, drift=None, now=FIXED_NOW
        )
        assert snap.measured_system["state"] == "pending_measurement"
        assert "readiness.json" in snap.measured_system["reason"]

    def test_held_out_fallback_when_readiness_pending(self):
        """When readiness has no measured κ, the held-out kappa file
        bridges the gap so /accuracy ships a real number."""
        held_out = {
            "schema_version": "1.0.0",
            "evaluated": 100,
            "kappa": 0.85,
            "ci_low": 0.78,
            "ci_high": 0.92,
            "observed_agreement": 0.93,
            "by_standard": [
                # Sub-standard rows are substrate; the public snapshot
                # must not echo them. Test below verifies the leak.
                {"standard_id": "ACC-01", "n": 14, "kappa": 0.82,
                 "ci_low": 0.71, "ci_high": 0.93,
                 "observed_agreement": 0.93},
            ],
        }
        snap = accuracy_generator.build_snapshot(
            readiness=None,
            drift=None,
            held_out=held_out,
            now=FIXED_NOW,
        )
        assert snap.measured_system["state"] == "measured"
        assert snap.measured_system["value"] == 0.85
        assert snap.measured_system["ci_low"] == 0.78
        assert snap.measured_system["ci_high"] == 0.92
        assert snap.measured_system["sample_size"] == 100

    def test_held_out_fallback_does_not_leak_per_standard_data(self):
        """The held-out file's by_standard rows include standard_ids;
        those are substrate and must not appear in the public snapshot."""
        held_out = {
            "schema_version": "1.0.0",
            "evaluated": 100,
            "kappa": 0.85,
            "ci_low": 0.78,
            "ci_high": 0.92,
            "by_standard": [
                {"standard_id": "ACC-01", "n": 14, "kappa": 0.82,
                 "ci_low": 0.71, "ci_high": 0.93,
                 "observed_agreement": 0.93},
                {"standard_id": "GRM-06", "n": 18, "kappa": 0.71,
                 "ci_low": 0.55, "ci_high": 0.87,
                 "observed_agreement": 0.83},
            ],
        }
        snap = accuracy_generator.build_snapshot(
            readiness=None,
            drift=None,
            held_out=held_out,
            now=FIXED_NOW,
        )
        import json
        blob = json.dumps(snap.__dict__)
        assert "ACC-01" not in blob
        assert "GRM-06" not in blob
        assert "by_standard" not in blob

    def test_readiness_takes_precedence_over_held_out(self):
        """When readiness has measured κ AND held_out is present,
        readiness wins — graduation_metrics is the long-term substrate."""
        held_out = {"evaluated": 100, "kappa": 0.50, "ci_low": 0.40, "ci_high": 0.60}
        snap = accuracy_generator.build_snapshot(
            readiness=_readiness_with_two_measured(),
            drift=None,
            held_out=held_out,
            now=FIXED_NOW,
        )
        # Sample-weighted aggregate of readiness rows, NOT 0.50 from held_out.
        assert snap.measured_system["state"] == "measured"
        assert snap.measured_system["value"] != 0.50

    def test_pending_when_neither_readiness_nor_held_out_have_data(self):
        snap = accuracy_generator.build_snapshot(
            readiness=None,
            drift=None,
            held_out={"evaluated": 0, "kappa": None},
            now=FIXED_NOW,
        )
        assert snap.measured_system["state"] == "pending_measurement"

    def test_pending_when_no_standard_has_measured_kappa(self):
        # No criteria.kappa.value on any standard → pending.
        readiness = _readiness_with_two_measured()
        for s in readiness["standards"]:
            for tier in ("autonomous", "batch_approval"):
                block = s.get(tier)
                if isinstance(block, dict):
                    block.pop("criteria", None)
        snap = accuracy_generator.build_snapshot(
            readiness=readiness, drift=None, now=FIXED_NOW
        )
        assert snap.measured_system["state"] == "pending_measurement"
        assert "weekly κ series" in snap.measured_system["reason"]

    def test_sample_weighted_aggregate(self):
        snap = accuracy_generator.build_snapshot(
            readiness=_readiness_with_two_measured(),
            drift=None,
            now=FIXED_NOW,
        )
        # Sample-weighted: (0.92 × 600 + 0.84 × 200) / (600 + 200)
        # = (552 + 168) / 800 = 0.9
        assert snap.measured_system["state"] == "measured"
        assert snap.measured_system["value"] == pytest.approx(0.9, rel=0.01)
        # Aggregated CIs preserve the same weighting.
        assert (
            snap.measured_system["ci_low"]
            < snap.measured_system["value"]
            < snap.measured_system["ci_high"]
        )
        assert snap.measured_system["sample_size"] == 800


class TestSelfDrift:
    def test_pending_when_drift_missing(self):
        snap = accuracy_generator.build_snapshot(
            readiness=_readiness_with_two_measured(),
            drift=None,
            now=FIXED_NOW,
        )
        assert snap.measured_self_drift["state"] == "pending_measurement"
        assert "Session 7 drift panel" in snap.measured_self_drift["reason"]

    def test_measured_when_drift_present(self):
        snap = accuracy_generator.build_snapshot(
            readiness=_readiness_with_two_measured(),
            drift=_drift(),
            now=FIXED_NOW,
        )
        assert snap.measured_self_drift["state"] == "measured"
        assert snap.measured_self_drift["value"] == pytest.approx(0.91)


class TestByLevel:
    def test_zeros_when_readiness_missing(self):
        snap = accuracy_generator.build_snapshot(
            readiness=None, drift=None, now=FIXED_NOW
        )
        assert snap.by_level == {
            "robo_labels": 0,
            "batch_approval": 0,
            "autonomous": 0,
        }

    def test_passes_through_when_present(self):
        snap = accuracy_generator.build_snapshot(
            readiness=_readiness_with_two_measured(),
            drift=None,
            now=FIXED_NOW,
        )
        assert snap.by_level == {
            "robo_labels": 41,
            "batch_approval": 4,
            "autonomous": 2,
        }


class TestStandardsCounts:
    def test_total_locks_at_47(self):
        snap = accuracy_generator.build_snapshot(
            readiness=None, drift=None, now=FIXED_NOW
        )
        assert snap.standards_total == 47

    def test_measured_counts_only_standards_with_kappa(self):
        snap = accuracy_generator.build_snapshot(
            readiness=_readiness_with_two_measured(),
            drift=None,
            now=FIXED_NOW,
        )
        assert snap.standards_measured == 2


class TestGeneratedAt:
    def test_is_iso_utc(self):
        snap = accuracy_generator.build_snapshot(
            readiness=None, drift=None, now=FIXED_NOW
        )
        assert snap.generated_at == "2026-04-25T18:00:00Z"
