"""Tests for the pipeline orchestrator.

Covers:
    - Calibration file auto-discovery
    - Output path resolution logic
    - Pipeline metadata stamping
    - Atomic write behavior

The orchestrator is primarily glue code, so these tests focus on the
decision logic rather than the stage execution (which is tested by
the individual tool test suites).
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import pytest

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

from pipeline_run import (
    add_pipeline_metadata,
    discover_calibration_files,
    write_output,
)


# ---------------------------------------------------------------------------
# discover_calibration_files
# ---------------------------------------------------------------------------

class TestDiscoverCalibrationFiles:
    def test_explicit_paths_returned_when_valid(self, tmp_path):
        f1 = tmp_path / "cal1.json"
        f1.write_text(json.dumps({"cases": [{"human_verdict": "pass"}]}))
        result = discover_calibration_files([f1])
        assert result == [f1]

    def test_missing_explicit_path_skipped(self, tmp_path):
        missing = tmp_path / "does_not_exist.json"
        result = discover_calibration_files([missing])
        assert result == []

    def test_none_triggers_auto_discovery(self, monkeypatch, tmp_path):
        """When no explicit paths given, auto-discover from evals/industry/."""
        # Create a mock evals/industry/ directory
        import pipeline_run
        monkeypatch.setattr(pipeline_run, "EVALS_INDUSTRY_DIR", tmp_path)

        # File with annotations
        annotated = tmp_path / "healthcare.json"
        annotated.write_text(json.dumps({
            "cases": [{"human_verdict": "pass", "input": "test"}]
        }))

        # File without annotations
        unannotated = tmp_path / "raw.json"
        unannotated.write_text(json.dumps({
            "cases": [{"human_verdict": None, "input": "test"}]
        }))

        result = discover_calibration_files(None)
        assert annotated in result
        assert unannotated not in result


# ---------------------------------------------------------------------------
# add_pipeline_metadata
# ---------------------------------------------------------------------------

class TestPipelineMetadata:
    def test_adds_pipeline_key(self):
        data = {"cases": []}
        result = add_pipeline_metadata(data, ["extract", "annotate"], 12.5)
        assert "pipeline" in result
        assert result["pipeline"]["stages_run"] == ["extract", "annotate"]
        assert result["pipeline"]["elapsed_seconds"] == 12.5
        assert "completed_at" in result["pipeline"]
        assert "version" in result["pipeline"]

    def test_preserves_existing_data(self):
        data = {"cases": [{"input": "test"}], "domain": "fintech"}
        result = add_pipeline_metadata(data, ["load"], 1.0)
        assert result["domain"] == "fintech"
        assert len(result["cases"]) == 1


# ---------------------------------------------------------------------------
# write_output (atomic writes)
# ---------------------------------------------------------------------------

class TestWriteOutput:
    def test_creates_file(self, tmp_path):
        output_path = tmp_path / "output.json"
        data = {"cases": [{"input": "test"}]}
        write_output(data, output_path)
        assert output_path.exists()
        loaded = json.loads(output_path.read_text())
        assert loaded["cases"][0]["input"] == "test"

    def test_creates_parent_directories(self, tmp_path):
        output_path = tmp_path / "nested" / "deep" / "output.json"
        write_output({"cases": []}, output_path)
        assert output_path.exists()

    def test_overwrites_existing_file(self, tmp_path):
        output_path = tmp_path / "output.json"
        output_path.write_text('{"old": true}')
        write_output({"cases": [], "new": True}, output_path)
        loaded = json.loads(output_path.read_text())
        assert "new" in loaded
        assert "old" not in loaded

    def test_no_temp_file_left_on_success(self, tmp_path):
        output_path = tmp_path / "output.json"
        write_output({"cases": []}, output_path)
        # Only the output file should exist, no .pipeline_ temp files
        files = list(tmp_path.iterdir())
        assert len(files) == 1
        assert files[0].name == "output.json"
