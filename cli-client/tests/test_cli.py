"""Tests for the contentrx CLI.

Focus:
  - batch loader correctness and error paths
  - HTTP error translation to typed exit codes
  - argparse dispatch and end-to-end happy path (HTTP layer mocked)
"""

from __future__ import annotations

import io
import json
import sys
import urllib.error
from pathlib import Path
from unittest.mock import patch

import pytest

from contentrx import main as cli
from contentrx.main import (
    CliError,
    EXIT_AUTH,
    EXIT_OK,
    EXIT_QUOTA,
    EXIT_RATELIMIT,
    EXIT_UPSTREAM,
    EXIT_USAGE,
    EXIT_VIOLATIONS,
    _parse_json_batch,
    _parse_txt_batch,
    load_batch_file,
    main,
    print_rationale_chain,
    print_result,
)


# ---------------------------------------------------------------------------
# Batch parser
# ---------------------------------------------------------------------------
def test_parse_txt_batch_strips_and_drops_blanks() -> None:
    raw = "first line\n\n  indented  \n\n"
    items = _parse_txt_batch(raw)
    assert items == [{"text": "first line"}, {"text": "indented"}]


def test_parse_txt_batch_rejects_empty() -> None:
    with pytest.raises(CliError) as excinfo:
        _parse_txt_batch("\n\n   \n")
    assert excinfo.value.code == EXIT_USAGE


def test_parse_json_batch_preserves_hints() -> None:
    raw = json.dumps(
        [
            {"text": "Save"},
            {"text": "Delete forever", "content_type": "button_cta"},
            {
                "text": "Are you sure?",
                "moment": "destructive_action",
                "audience": "product_ui",
            },
        ]
    )
    items = _parse_json_batch(raw)
    assert items[0] == {"text": "Save"}
    assert items[1] == {"text": "Delete forever", "content_type": "button_cta"}
    assert items[2]["moment"] == "destructive_action"
    assert items[2]["audience"] == "product_ui"


def test_parse_json_batch_rejects_non_list() -> None:
    with pytest.raises(CliError) as excinfo:
        _parse_json_batch('{"text": "Save"}')
    assert excinfo.value.code == EXIT_USAGE


def test_parse_json_batch_rejects_missing_text() -> None:
    raw = json.dumps([{"content_type": "button_cta"}])
    with pytest.raises(CliError) as excinfo:
        _parse_json_batch(raw)
    assert excinfo.value.code == EXIT_USAGE


def test_load_batch_file_rejects_bad_extension(tmp_path: Path) -> None:
    bogus = tmp_path / "strings.csv"
    bogus.write_text("a,b,c")
    with pytest.raises(CliError) as excinfo:
        load_batch_file(bogus)
    assert excinfo.value.code == EXIT_USAGE


def test_load_batch_file_rejects_missing(tmp_path: Path) -> None:
    with pytest.raises(CliError) as excinfo:
        load_batch_file(tmp_path / "missing.txt")
    assert excinfo.value.code == EXIT_USAGE


# ---------------------------------------------------------------------------
# HTTP error translation
# ---------------------------------------------------------------------------
def _http_error(code: int, body: dict) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(
        url="https://contentrx.io/api/check",
        code=code,
        msg="",
        hdrs=None,  # type: ignore[arg-type]
        fp=io.BytesIO(json.dumps(body).encode("utf-8")),
    )


@pytest.fixture(autouse=True)
def _set_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CONTENTRX_API_KEY", "cx_test_key_xxxxxxxxxxxxxxxx")
    # Unset any URL override so tests don't hit a real backend.
    monkeypatch.delenv("CONTENTRX_API_URL", raising=False)


def test_check_text_translates_401_to_auth_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_urlopen(req, timeout=None):
        raise _http_error(401, {"error": "Invalid API key"})

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    with pytest.raises(CliError) as excinfo:
        cli.check_text("Click here")
    assert excinfo.value.code == EXIT_AUTH


def test_check_text_translates_402_to_quota_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_urlopen(req, timeout=None):
        raise _http_error(
            402,
            {"error": "Monthly quota exhausted", "quota": 25, "resets_at": "2026-05-01T00:00:00Z"},
        )

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    with pytest.raises(CliError) as excinfo:
        cli.check_text("Click here")
    assert excinfo.value.code == EXIT_QUOTA
    assert "quota exhausted" in str(excinfo.value).lower()


def test_check_text_translates_429_to_ratelimit(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_urlopen(req, timeout=None):
        raise _http_error(429, {"error": "Rate limit exceeded", "reset_at": "now"})

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    with pytest.raises(CliError) as excinfo:
        cli.check_text("Click here")
    assert excinfo.value.code == EXIT_RATELIMIT


def test_check_text_translates_5xx_to_upstream(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_urlopen(req, timeout=None):
        raise _http_error(503, {"error": "down"})

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    with pytest.raises(CliError) as excinfo:
        cli.check_text("Click here")
    assert excinfo.value.code == EXIT_UPSTREAM


def test_check_text_translates_url_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_urlopen(req, timeout=None):
        raise urllib.error.URLError("Connection refused")

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    with pytest.raises(CliError) as excinfo:
        cli.check_text("Click here")
    assert excinfo.value.code == EXIT_UPSTREAM


# ---------------------------------------------------------------------------
# Happy path — argparse dispatch with mocked HTTP
# ---------------------------------------------------------------------------
class _FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._body = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def test_main_pass_returns_zero(monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    payload = {
        "result": {
            "content_type": "button_cta",
            "overall_verdict": "pass",
            "violations": [],
            "summary": "Looks good.",
        },
        "usage": {"used": 1, "quota": 25, "remaining": 24, "plan": "free"},
    }
    monkeypatch.setattr(
        "urllib.request.urlopen", lambda req, timeout=None: _FakeResponse(payload)
    )
    code = main(["Save changes"])
    assert code == EXIT_OK
    out = capsys.readouterr().out
    assert "PASS" in out


def test_main_fail_returns_violations_code(monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    payload = {
        "result": {
            "content_type": "button_cta",
            "overall_verdict": "fail",
            "violations": [
                {
                    "standard_id": "ACC-01",
                    "issue": "Contains 'click here'",
                    "suggestion": "Use descriptive link text.",
                }
            ],
            "summary": "Accessibility issue.",
        },
        "usage": {"used": 1, "quota": 25},
    }
    monkeypatch.setattr(
        "urllib.request.urlopen", lambda req, timeout=None: _FakeResponse(payload)
    )
    code = main(["Click here"])
    assert code == EXIT_VIOLATIONS
    out = capsys.readouterr().out
    assert "ACC-01" in out


def test_main_json_mode_emits_raw_response(monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    payload = {
        "result": {"overall_verdict": "pass", "violations": [], "content_type": "button_cta"},
        "usage": {},
    }
    monkeypatch.setattr(
        "urllib.request.urlopen", lambda req, timeout=None: _FakeResponse(payload)
    )
    code = main(["--json", "Save"])
    assert code == EXIT_OK
    out = capsys.readouterr().out.strip()
    parsed = json.loads(out)
    assert parsed["result"]["overall_verdict"] == "pass"


def test_main_missing_api_key_reports_auth(
    monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    monkeypatch.delenv("CONTENTRX_API_KEY", raising=False)
    code = main(["Save"])
    assert code == EXIT_AUTH
    err = capsys.readouterr().err
    assert "CONTENTRX_API_KEY" in err


def test_main_rejects_text_and_batch_together(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys
) -> None:
    f = tmp_path / "strings.txt"
    f.write_text("Save\n")
    with pytest.raises(SystemExit) as excinfo:
        main(["--batch", str(f), "Save"])
    assert excinfo.value.code == EXIT_USAGE


def test_main_requires_text_or_batch(monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    with pytest.raises(SystemExit) as excinfo:
        main([])
    assert excinfo.value.code == EXIT_USAGE


def test_main_batch_mode_iterates_strings(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys
) -> None:
    batch = tmp_path / "strings.txt"
    batch.write_text("Save changes\nDelete forever\n")

    responses = iter(
        [
            {
                "result": {
                    "content_type": "button_cta",
                    "overall_verdict": "pass",
                    "violations": [],
                    "summary": "",
                },
                "usage": {},
            },
            {
                "result": {
                    "content_type": "button_cta",
                    "overall_verdict": "fail",
                    "violations": [{"standard_id": "X", "issue": "bad"}],
                    "summary": "",
                },
                "usage": {},
            },
        ]
    )
    monkeypatch.setattr(
        "urllib.request.urlopen",
        lambda req, timeout=None: _FakeResponse(next(responses)),
    )
    code = main(["--batch", str(batch)])
    assert code == EXIT_VIOLATIONS


# ---------------------------------------------------------------------------
# Render helper
# ---------------------------------------------------------------------------
def test_print_result_returns_true_for_pass() -> None:
    buf = io.StringIO()
    payload = {
        "result": {
            "content_type": "button_cta",
            "overall_verdict": "pass",
            "violations": [],
            "summary": "OK",
        }
    }
    assert print_result("Save", payload, verbose=False, stream=buf) is True
    assert "PASS" in buf.getvalue()


def test_print_result_verbose_includes_usage() -> None:
    buf = io.StringIO()
    payload = {
        "result": {
            "content_type": "button_cta",
            "overall_verdict": "pass",
            "violations": [],
            "summary": "",
        },
        "usage": {"used": 1, "quota": 25},
        "latency_ms": 123,
    }
    print_result("Save", payload, verbose=True, stream=buf)
    out = buf.getvalue()
    assert "1 of 25" in out
    assert "123 ms" in out


# ---------------------------------------------------------------------------
# --explain — rationale chain output (human-eval build plan Session 21)
# ---------------------------------------------------------------------------
def test_print_rationale_chain_empty_is_no_op() -> None:
    buf = io.StringIO()
    print_rationale_chain(
        {"result": {"rationale_chain": []}},
        stream=buf,
    )
    assert buf.getvalue() == ""


def test_print_rationale_chain_renders_hops_with_confidence_and_rules() -> None:
    buf = io.StringIO()
    print_rationale_chain(
        {
            "result": {
                "rationale_chain": [
                    {
                        "step": "classify",
                        "inputs": {"text": "Proceed?"},
                        "output": {"content_type": "short_ui_copy"},
                        "confidence": 0.9,
                        "rule_versions": {},
                        "ambiguity_flag": None,
                    },
                    {
                        "step": "detect_moment",
                        "inputs": {},
                        "output": {"moment": "decision_point"},
                        "confidence": 0.5,
                        "rule_versions": {"CLR-01": "4.6.1"},
                        "ambiguity_flag": "situation_uncertain",
                    },
                ]
            }
        },
        stream=buf,
    )
    out = buf.getvalue()
    assert "Rationale chain:" in out
    assert "1. classify · 90%" in out
    assert "content_type: short_ui_copy" in out
    # Second hop includes confidence, ambiguity flag, and rule versions.
    assert "2. detect_moment · 50% · flag=situation_uncertain" in out
    assert "CLR-01=v4.6.1" in out


def test_print_rationale_chain_missing_chain_key_is_safe() -> None:
    # Pre-v1.2.0 responses don't carry `rationale_chain`. The helper
    # should no-op rather than raise.
    buf = io.StringIO()
    print_rationale_chain({"result": {}}, stream=buf)
    assert buf.getvalue() == ""


# ---------------------------------------------------------------------------
# Moment-detected line in the default verdict block — human-eval build plan
# Session 22.
# ---------------------------------------------------------------------------
def test_print_result_includes_moment_line_for_non_default_moment() -> None:
    buf = io.StringIO()
    payload = {
        "result": {
            "content_type": "short_ui_copy",
            "overall_verdict": "pass",
            "violations": [],
            "summary": "",
            "moment": "decision_point",
        }
    }
    print_result("Choose a plan", payload, verbose=False, stream=buf)
    out = buf.getvalue()
    assert "Moment: decision_point" in out
    # decision_point has 4 emphasized + 1 suppressed in MOMENT_WEIGHTS
    assert "4 emphasized" in out
    assert "1 suppressed" in out


def test_print_result_suppresses_moment_line_for_default() -> None:
    buf = io.StringIO()
    payload = {
        "result": {
            "content_type": "short_ui_copy",
            "overall_verdict": "pass",
            "violations": [],
            "summary": "",
            "moment": "browsing_discovery",
        }
    }
    print_result("Welcome to ContentRX", payload, verbose=False, stream=buf)
    assert "Moment:" not in buf.getvalue()


def test_print_result_moment_line_without_weighted_counts_has_no_suffix() -> None:
    """Moments without any weighted standards render without a suffix."""
    buf = io.StringIO()
    payload = {
        "result": {
            "content_type": "short_ui_copy",
            "overall_verdict": "pass",
            "violations": [],
            "summary": "",
            "moment": "celebration",
        }
    }
    print_result("Milestone reached!", payload, verbose=False, stream=buf)
    out = buf.getvalue()
    assert "Moment: celebration\n" in out
    # No parenthesised suffix for moments that carry no weights.
    assert "Moment: celebration (" not in out
