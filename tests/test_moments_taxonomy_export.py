"""Pin the moments_taxonomy.json export against moments.py.

Human-eval build plan Session 20. The docs site reads
`src/content_checker/standards/moments_taxonomy.json` at build time; it
cannot import moments.py. To keep the JSON honest, this test re-runs
the `tools/export_moments.py` build in-memory and diffs against the
committed file. Drift fails CI, not a running docs build.

Bumping moments.py? Re-run:
    python3 tools/export_moments.py
and commit the refreshed JSON.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tools.export_moments import OUTPUT_PATH, build_payload


@pytest.fixture
def committed() -> dict:
    return json.loads(Path(OUTPUT_PATH).read_text(encoding="utf-8"))


@pytest.fixture
def rebuilt() -> dict:
    return build_payload()


def test_schema_version_and_counts_match(committed, rebuilt):
    assert committed["schema_version"] == rebuilt["schema_version"]
    assert committed["total_moments"] == rebuilt["total_moments"]
    assert committed["default_moment"] == rebuilt["default_moment"]
    assert committed["confidence_threshold"] == rebuilt["confidence_threshold"]
    assert committed["confidence_matched"] == rebuilt["confidence_matched"]


def test_moment_ids_match_in_order(committed, rebuilt):
    assert [m["id"] for m in committed["moments"]] == [
        m["id"] for m in rebuilt["moments"]
    ]


def test_full_payload_matches(committed, rebuilt):
    """Strictest check — moments.py drift must trigger a re-export."""
    assert committed == rebuilt, (
        "moments_taxonomy.json is out of sync with moments.py. "
        "Re-run `python3 tools/export_moments.py` and commit the result."
    )


def test_thirteen_moments_present(committed):
    """Guards against accidental deletion of the JSON export."""
    assert committed["total_moments"] == 13
    assert len(committed["moments"]) == 13


def test_situation_properties_flag_the_three_moments(committed):
    flagged = {
        m["id"]: m["situation_property"]
        for m in committed["moments"]
        if m["situation_property"] is not None
    }
    assert flagged == {
        "destructive_action": "destructive",
        "trust_permission": "permission-gated",
        "compliance_disclosure": "compliance",
    }
