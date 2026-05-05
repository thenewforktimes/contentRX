"""Tests for the CLI entry point.

Focus: path validation, batch loader correctness, argparse dispatch, and
error-path exit codes. No real Anthropic API calls — the pipeline is
monkeypatched where needed.
"""

from __future__ import annotations

import io
import json
import os
import sys
from pathlib import Path

import pytest

from cli.main import (
    MAX_BATCH_FILE_SIZE,
    _load_batch_file,
    _parse_json_batch,
    _parse_txt_batch,
    main,
    print_batch_result,
    print_result,
)
from content_checker.models import (
    BatchResult,
    CheckResult,
    ConsistencyViolation,
    ContentItem,
    ItemResult,
    PipelineMeta,
    TokenUsage,
    Violation,
)


# ---------------------------------------------------------------------------
# _load_batch_file — happy paths
# ---------------------------------------------------------------------------


class TestLoadBatchFileHappy:
    def test_load_txt(self, tmp_path):
        f = tmp_path / "strings.txt"
        f.write_text("Save changes\nYour account is ready.\n\nDelete file\n")
        items = _load_batch_file(str(f))
        assert len(items) == 3
        assert items[0].text == "Save changes"
        assert items[1].text == "Your account is ready."
        assert items[2].text == "Delete file"

    def test_load_json_strings(self, tmp_path):
        f = tmp_path / "strings.json"
        f.write_text(json.dumps(["Save changes", "Delete file"]))
        items = _load_batch_file(str(f))
        assert len(items) == 2
        assert items[0].text == "Save changes"
        assert items[0].label == ""

    def test_load_json_objects(self, tmp_path):
        f = tmp_path / "strings.json"
        f.write_text(json.dumps([
            {"text": "Save changes", "label": "CTA", "content_type": "button_cta"},
            {"text": "Your settings", "label": "Nav", "file_path": "a.jsx", "line_number": 12},
        ]))
        items = _load_batch_file(str(f))
        assert len(items) == 2
        assert items[0].label == "CTA"
        assert items[0].content_type == "button_cta"
        assert items[1].file_path == "a.jsx"
        assert items[1].line_number == 12

    def test_load_json_mixed_strings_and_objects(self, tmp_path):
        f = tmp_path / "mixed.json"
        f.write_text(json.dumps(["Save", {"text": "Cancel", "label": "btn"}]))
        items = _load_batch_file(str(f))
        assert items[0].text == "Save"
        assert items[1].label == "btn"

    def test_load_strips_leading_and_trailing_whitespace_in_path(self, tmp_path):
        f = tmp_path / "strings.txt"
        f.write_text("Hello\n")
        items = _load_batch_file(f"  {f}  ")
        assert len(items) == 1

    def test_load_expands_tilde(self, tmp_path, monkeypatch):
        monkeypatch.setenv("HOME", str(tmp_path))
        f = tmp_path / "strings.txt"
        f.write_text("Hi\n")
        items = _load_batch_file("~/strings.txt")
        assert items[0].text == "Hi"

    def test_json_invalid_line_number_defaults_to_zero(self, tmp_path):
        f = tmp_path / "bad_line.json"
        f.write_text(json.dumps([{"text": "Hi", "line_number": "not-a-number"}]))
        items = _load_batch_file(str(f))
        assert items[0].line_number == 0


# ---------------------------------------------------------------------------
# _load_batch_file — validation
# ---------------------------------------------------------------------------


class TestLoadBatchFileValidation:
    def test_missing_file_raises(self, tmp_path):
        with pytest.raises(FileNotFoundError) as exc:
            _load_batch_file(str(tmp_path / "nope.txt"))
        assert "not found" in str(exc.value)

    def test_directory_rejected(self, tmp_path):
        with pytest.raises(ValueError) as exc:
            _load_batch_file(str(tmp_path))
        assert "not a regular file" in str(exc.value)

    def test_oversized_file_rejected(self, tmp_path, monkeypatch):
        # Shrink the cap so we don't have to create a 10 MB file.
        monkeypatch.setattr("cli.main.MAX_BATCH_FILE_SIZE", 32)
        f = tmp_path / "big.txt"
        f.write_text("x" * 64)
        with pytest.raises(ValueError) as exc:
            _load_batch_file(str(f))
        assert "too large" in str(exc.value)

    def test_unsupported_extension_rejected(self, tmp_path):
        f = tmp_path / "strings.yaml"
        f.write_text("- Save\n- Delete\n")
        with pytest.raises(ValueError) as exc:
            _load_batch_file(str(f))
        assert "Unsupported" in str(exc.value)

    def test_no_extension_rejected(self, tmp_path):
        f = tmp_path / "batch"
        f.write_text("Save\n")
        with pytest.raises(ValueError):
            _load_batch_file(str(f))

    def test_fifo_rejected(self, tmp_path):
        fifo = tmp_path / "pipe"
        try:
            os.mkfifo(fifo)
        except (AttributeError, OSError):
            pytest.skip("mkfifo not available on this platform")
        with pytest.raises(ValueError):
            _load_batch_file(str(fifo))


# ---------------------------------------------------------------------------
# _parse_json_batch — malformed inputs
# ---------------------------------------------------------------------------


class TestParseJsonBatch:
    def test_invalid_json_raises(self, tmp_path):
        f = tmp_path / "bad.json"
        f.write_text("{not valid json")
        with pytest.raises(ValueError) as exc:
            _parse_json_batch(f)
        assert "Invalid JSON" in str(exc.value)

    def test_top_level_object_rejected(self, tmp_path):
        f = tmp_path / "object.json"
        f.write_text(json.dumps({"text": "Save"}))
        with pytest.raises(ValueError) as exc:
            _parse_json_batch(f)
        assert "array" in str(exc.value)

    def test_entry_with_non_string_text_rejected(self, tmp_path):
        f = tmp_path / "bad_text.json"
        f.write_text(json.dumps([{"text": 123}]))
        with pytest.raises(ValueError) as exc:
            _parse_json_batch(f)
        assert "text" in str(exc.value)

    def test_entry_of_wrong_type_rejected(self, tmp_path):
        f = tmp_path / "bad_entry.json"
        f.write_text(json.dumps([["nested"]]))
        with pytest.raises(ValueError) as exc:
            _parse_json_batch(f)
        assert "string or object" in str(exc.value)

    def test_empty_array_returns_empty(self, tmp_path):
        f = tmp_path / "empty.json"
        f.write_text("[]")
        assert _parse_json_batch(f) == []


# ---------------------------------------------------------------------------
# Printing (smoke tests — they just have to render without raising)
# ---------------------------------------------------------------------------


def _make_check_result(verdict: str = "pass", violations=None) -> CheckResult:
    return CheckResult(
        content_type="button_cta",
        overall_verdict=verdict,
        violations=violations or [],
        passes=[],
        summary="Looks good.",
        pipeline=PipelineMeta(
            standards_checked=6,
            standards_total=46,
            preprocess_violations=0,
            llm_candidates=0,
        ),
    )


class TestPrintResult:
    def test_pass_renders(self, capsys):
        print_result("Save", _make_check_result(), 0.5, TokenUsage(100, 50))
        out = capsys.readouterr().out
        assert "PASS" in out
        assert "button_cta" in out

    def test_fail_with_violations(self, capsys):
        v = Violation(
            standard_id="GRM-01",
            rule="Use Oxford commas.",
            issue="Missing Oxford comma.",
            suggestion="Add a comma before 'and'.",
            source="deterministic",
        )
        print_result("A, B and C", _make_check_result("fail", [v]), 0.1, TokenUsage())
        out = capsys.readouterr().out
        assert "FAIL" in out
        # ADR 2026-04-25: substrate fields (standard_id, rule) MUST NOT
        # appear in CLI output. The internal substrate is unchanged on
        # the model object — it just doesn't reach stdout.
        assert "GRM-01" not in out
        assert "Use Oxford commas." not in out
        assert "Missing Oxford comma." in out
        assert "[deterministic]" in out

    def test_verbose_prints_pipeline(self, capsys):
        print_result("Save", _make_check_result(), 0.7, TokenUsage(100, 50), verbose=True)
        out = capsys.readouterr().out
        assert "Standards checked" in out
        assert "Latency" in out


class TestPrintBatchResult:
    def test_pass(self, capsys):
        batch = BatchResult(overall_verdict="pass", total_latency=1.0)
        batch.item_results.append(ItemResult(
            item=ContentItem(text="Save", label="CTA"),
            result=_make_check_result(),
        ))
        print_batch_result(batch)
        out = capsys.readouterr().out
        assert "PASS" in out
        assert "1/1" in out

    def test_consistency_violation_prints(self, capsys):
        batch = BatchResult(overall_verdict="fail")
        batch.item_results.append(ItemResult(
            item=ContentItem(text="Settings"),
            result=_make_check_result(),
        ))
        batch.consistency_violations.append(ConsistencyViolation(
            standard_id="CON-01",
            rule="Use consistent terminology.",
            issue="'Settings' vs 'Preferences'",
            suggestion="Pick one.",
            items_involved=["Settings", "Preferences"],
        ))
        print_batch_result(batch)
        out = capsys.readouterr().out
        assert "Consistency issues" in out
        # ADR 2026-04-25: substrate fields (standard_id, rule) MUST NOT
        # appear in CLI output, including for consistency violations.
        assert "CON-01" not in out
        assert "Use consistent terminology." not in out
        assert "'Settings' vs 'Preferences'" in out


# ---------------------------------------------------------------------------
# main() — argparse dispatch
# ---------------------------------------------------------------------------


class TestMainDispatch:
    """Patch the pipeline functions so main() can be exercised end-to-end."""

    def _patch_check(self, monkeypatch, verdict: str = "pass"):
        calls = {}

        def fake_check(text, content_type=None, model=None, use_llm_classifier=True):
            calls["text"] = text
            calls["content_type"] = content_type
            calls["model"] = model
            return _make_check_result(verdict), 0.1, TokenUsage(10, 5)

        monkeypatch.setattr("cli.main.check", fake_check)
        return calls

    def _patch_batch(self, monkeypatch, verdict: str = "pass"):
        calls = {}

        def fake_check_batch(items, model=None, use_llm_classifier=True):
            calls["items"] = items
            calls["model"] = model
            batch = BatchResult(overall_verdict=verdict)
            for item in items:
                batch.item_results.append(ItemResult(
                    item=item, result=_make_check_result(verdict),
                ))
            return batch

        monkeypatch.setattr("cli.main.check_batch", fake_check_batch)
        return calls

    def test_single_text(self, monkeypatch, capsys):
        calls = self._patch_check(monkeypatch)
        monkeypatch.setattr(sys, "argv", ["content-checker", "Save changes"])
        main()
        assert calls["text"] == "Save changes"
        out = capsys.readouterr().out
        assert "PASS" in out

    def test_single_text_json_output(self, monkeypatch, capsys):
        self._patch_check(monkeypatch)
        monkeypatch.setattr(sys, "argv", ["content-checker", "--json", "Save"])
        main()
        out = capsys.readouterr().out
        parsed = json.loads(out)
        # ADR 2026-04-25: CLI --json emits the public envelope, which
        # uses `verdict` (not the legacy `overall_verdict`), carries
        # `schema_version`, and has no substrate fields at any depth.
        # 2.2.0 added content_type + moment as customer-grounding
        # fields — those are NOT substrate, they describe the
        # customer's own input back to them.
        assert parsed["verdict"] == "pass"
        assert parsed["schema_version"] == "2.5.0"
        assert "overall_verdict" not in parsed
        assert "rationale_chain" not in parsed
        assert "passes" not in parsed
        assert "pipeline" not in parsed

    def test_type_override_forwarded(self, monkeypatch):
        calls = self._patch_check(monkeypatch)
        monkeypatch.setattr(sys, "argv", [
            "content-checker", "--type", "error_message", "Oops",
        ])
        main()
        assert calls["content_type"] == "error_message"

    def test_batch_mode(self, monkeypatch, tmp_path, capsys):
        f = tmp_path / "strings.txt"
        f.write_text("Save\nCancel\n")
        calls = self._patch_batch(monkeypatch)
        monkeypatch.setattr(sys, "argv", ["content-checker", "--batch", str(f)])
        main()
        assert len(calls["items"]) == 2
        out = capsys.readouterr().out
        assert "Batch verdict" in out

    def test_batch_missing_file_exits_nonzero(self, monkeypatch, tmp_path, capsys):
        monkeypatch.setattr(sys, "argv", [
            "content-checker", "--batch", str(tmp_path / "missing.txt"),
        ])
        with pytest.raises(SystemExit) as exc:
            main()
        assert exc.value.code == 1
        err = capsys.readouterr().err
        assert "not found" in err

    def test_batch_unsupported_extension_exits_nonzero(self, monkeypatch, tmp_path, capsys):
        f = tmp_path / "bad.yaml"
        f.write_text("- Save\n")
        monkeypatch.setattr(sys, "argv", ["content-checker", "--batch", str(f)])
        with pytest.raises(SystemExit) as exc:
            main()
        assert exc.value.code == 1
        assert "Unsupported" in capsys.readouterr().err

    def test_empty_batch_file_exits_cleanly(self, monkeypatch, tmp_path, capsys):
        f = tmp_path / "empty.txt"
        f.write_text("")
        self._patch_batch(monkeypatch)
        monkeypatch.setattr(sys, "argv", ["content-checker", "--batch", str(f)])
        main()  # no SystemExit; prints a friendly message
        out = capsys.readouterr().out
        assert "No content" in out

    def test_oversized_text_exits_nonzero(self, monkeypatch, capsys):
        # Don't patch — the real check() should reject before any API call.
        huge = "x" * 200_000
        monkeypatch.setattr(sys, "argv", ["content-checker", huge])
        with pytest.raises(SystemExit) as exc:
            main()
        assert exc.value.code == 1
        assert "too long" in capsys.readouterr().err.lower()
