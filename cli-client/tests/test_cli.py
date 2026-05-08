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
    _confirm_proceed,
    _parse_json_batch,
    _parse_txt_batch,
    _print_dry_run_estimate,
    load_batch_file,
    main,
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
    # Schema 2.0.0 — top-level shape, no `result` wrapper.
    payload = {
        "schema_version": "2.0.0",
        "verdict": "pass",
        "review_reason": None,
        "violations": [],
        "warnings": [],
        "usage": {"used": 1, "quota": 25, "remaining": 24, "plan": "free"},
    }
    monkeypatch.setattr(
        "urllib.request.urlopen", lambda req, timeout=None: _FakeResponse(payload)
    )
    code = main(["Save changes"])
    assert code == EXIT_OK
    out = capsys.readouterr().out
    assert "All clear" in out


def test_main_fail_returns_violations_code(monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    payload = {
        "schema_version": "2.0.0",
        "verdict": "violation",
        "review_reason": None,
        "violations": [
            {
                "issue": "Contains 'click here'",
                "suggestion": "Use descriptive link text.",
                "severity": "high",
                "confidence": 0.9,
            }
        ],
        "warnings": [],
        "usage": {"used": 1, "quota": 25},
    }
    monkeypatch.setattr(
        "urllib.request.urlopen", lambda req, timeout=None: _FakeResponse(payload)
    )
    code = main(["Click here"])
    assert code == EXIT_VIOLATIONS
    out = capsys.readouterr().out
    # Substrate IDs (ACC-01 etc.) MUST NOT render. Issue text + severity do.
    assert "ACC-01" not in out
    assert "Contains 'click here'" in out
    assert "[Worth adjusting]" in out


def test_main_json_mode_emits_raw_response(monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    payload = {
        "schema_version": "2.0.0",
        "verdict": "pass",
        "review_reason": None,
        "violations": [],
        "warnings": [],
        "usage": {},
    }
    monkeypatch.setattr(
        "urllib.request.urlopen", lambda req, timeout=None: _FakeResponse(payload)
    )
    code = main(["--json", "Save"])
    assert code == EXIT_OK
    out = capsys.readouterr().out.strip()
    parsed = json.loads(out)
    assert parsed["verdict"] == "pass"
    assert parsed["schema_version"] == "2.0.0"


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
                "schema_version": "2.0.0",
                "verdict": "pass",
                "review_reason": None,
                "violations": [],
                "warnings": [],
                "usage": {},
            },
            {
                "schema_version": "2.0.0",
                "verdict": "violation",
                "review_reason": None,
                "violations": [
                    {
                        "issue": "bad",
                        "suggestion": "",
                        "severity": "high",
                        "confidence": 0.9,
                    }
                ],
                "warnings": [],
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
        "schema_version": "2.0.0",
        "verdict": "pass",
        "review_reason": None,
        "violations": [],
        "warnings": [],
    }
    assert print_result("Save", payload, verbose=False, stream=buf) is True
    assert "All clear" in buf.getvalue()


def test_print_result_renders_severity_and_issue_only() -> None:
    """Schema 2.0.0 — substrate fields (standard_id, rule_version,
    rationale_chain, moment) MUST NOT appear in the CLI output. The
    user sees severity + issue + suggestion."""
    buf = io.StringIO()
    payload = {
        "schema_version": "2.0.0",
        "verdict": "violation",
        "review_reason": None,
        "violations": [
            {
                "issue": "Generic CTA",
                "suggestion": "Use a specific verb.",
                "severity": "high",
                "confidence": 0.9,
            }
        ],
        "warnings": [],
    }
    print_result("Click here", payload, verbose=False, stream=buf)
    out = buf.getvalue()
    assert "[Worth adjusting]" in out
    assert "Generic CTA" in out
    assert "Use a specific verb." in out
    # Substrate must never leak.
    for forbidden in ("ACT-01", "CLR-01", "rule_version", "Moment:"):
        assert forbidden not in out


def test_print_result_verbose_includes_usage() -> None:
    buf = io.StringIO()
    payload = {
        "schema_version": "2.0.0",
        "verdict": "pass",
        "review_reason": None,
        "violations": [],
        "warnings": [],
        "usage": {"used": 1, "quota": 25},
        "latency_ms": 123,
    }
    print_result("Save", payload, verbose=True, stream=buf)
    out = buf.getvalue()
    assert "1 of 25" in out
    assert "123 ms" in out


def test_print_result_review_recommended_shows_humanized_reason() -> None:
    """Schema 2.0.0 surfaces typed review_reason at the top level. The
    CLI passes the raw enum through `humanize_review_reason` so the
    customer sees plain language, not engine-pipeline vocabulary."""
    buf = io.StringIO()
    payload = {
        "schema_version": "2.0.0",
        "verdict": "review_recommended",
        "review_reason": "low_confidence",
        "violations": [],
        "warnings": [],
    }
    passed = print_result("Maybe?", payload, verbose=False, stream=buf)
    out = buf.getvalue()
    assert "Worth a look" in out
    # Raw enum must NOT leak to the customer surface — humanized only.
    assert "low_confidence" not in out
    assert "We weren't fully sure about this one" in out
    # REVIEW counts as passed for exit-code purposes.
    assert passed is True


# ---------------------------------------------------------------------------
# Pre-action gate (PR-13) — dry-run + confirm
# ---------------------------------------------------------------------------
def test_confirm_proceed_yes_flag_skips_prompt() -> None:
    """`--yes` always proceeds without prompting (CI use)."""
    assert _confirm_proceed(100, yes=True) is True


def test_confirm_proceed_non_tty_proceeds_with_notice(
    monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    """Non-interactive shells (no TTY) auto-proceed but print the count
    to stderr so it appears in pipeline logs."""
    monkeypatch.setattr("sys.stdin.isatty", lambda: False)
    assert _confirm_proceed(47, yes=False) is True
    captured = capsys.readouterr()
    assert "47" in captured.err
    assert "checks" in captured.err


def test_confirm_proceed_tty_default_yes(
    monkeypatch: pytest.MonkeyPatch
) -> None:
    """In a TTY, an empty Enter accepts the default Y."""
    monkeypatch.setattr("sys.stdin.isatty", lambda: True)
    monkeypatch.setattr("builtins.input", lambda _prompt: "")
    assert _confirm_proceed(5, yes=False) is True


def test_confirm_proceed_tty_n_cancels(
    monkeypatch: pytest.MonkeyPatch
) -> None:
    """Typing n cancels."""
    monkeypatch.setattr("sys.stdin.isatty", lambda: True)
    monkeypatch.setattr("builtins.input", lambda _prompt: "n")
    assert _confirm_proceed(5, yes=False) is False


def test_confirm_proceed_eof_cancels(
    monkeypatch: pytest.MonkeyPatch
) -> None:
    """Ctrl-D / EOF on the prompt cancels (don't assume yes)."""
    monkeypatch.setattr("sys.stdin.isatty", lambda: True)

    def _eof(_prompt):
        raise EOFError

    monkeypatch.setattr("builtins.input", _eof)
    assert _confirm_proceed(5, yes=False) is False


def test_print_dry_run_estimate_returns_ok_and_prints_count(capsys) -> None:
    code = _print_dry_run_estimate(123)
    assert code == EXIT_OK
    out = capsys.readouterr().out
    assert "123" in out
    assert "checks" in out


def test_print_dry_run_estimate_singular(capsys) -> None:
    _print_dry_run_estimate(1)
    out = capsys.readouterr().out
    assert "1 check" in out  # singular


def test_main_dry_run_requires_batch(
    monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    """`--dry-run` without `--batch` is a usage error."""
    monkeypatch.setenv("CONTENTRX_API_KEY", "cx_test")
    # argparse's parser.error() calls sys.exit(2) → SystemExit, same
    # path as test_main_rejects_text_and_batch_together.
    with pytest.raises(SystemExit) as excinfo:
        main(["--dry-run", "Save"])
    assert excinfo.value.code == EXIT_USAGE


def test_main_dry_run_batch_does_not_call_api(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys
) -> None:
    """`--dry-run --batch FILE` prints the count and exits without
    making any HTTP calls."""
    monkeypatch.setenv("CONTENTRX_API_KEY", "cx_test")
    batch = tmp_path / "strings.txt"
    batch.write_text("one\ntwo\nthree\n")

    called = {"count": 0}

    def _explode(*_args, **_kwargs):
        called["count"] += 1
        raise AssertionError("urlopen should not be called in dry-run")

    monkeypatch.setattr("urllib.request.urlopen", _explode)

    code = main(["--batch", str(batch), "--dry-run"])
    assert code == EXIT_OK
    assert called["count"] == 0
    out = capsys.readouterr().out
    assert "3" in out


def test_main_batch_yes_skips_confirm(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """`--yes` proceeds without consulting input()."""
    monkeypatch.setenv("CONTENTRX_API_KEY", "cx_test")
    batch = tmp_path / "strings.txt"
    batch.write_text("only one\n")

    def _explode(_prompt):
        raise AssertionError("input() should not be called when --yes is set")

    monkeypatch.setattr("builtins.input", _explode)
    monkeypatch.setattr("sys.stdin.isatty", lambda: True)
    monkeypatch.setattr(
        "urllib.request.urlopen",
        lambda req, timeout=None: _FakeResponse(
            {
                "schema_version": "2.0.0",
                "verdict": "pass",
                "review_reason": None,
                "violations": [],
                "warnings": [],
                "usage": {},
            }
        ),
    )

    code = main(["--batch", str(batch), "--yes"])
    assert code == EXIT_OK


# ---------------------------------------------------------------------------
# _api_base_url URL resolution
# ---------------------------------------------------------------------------
class Test_ApiBaseUrl:
    """The CLI accepts CONTENTRX_API_URL with HTTPS; falls back to the
    production default when the var is missing OR an empty string. The
    GitHub Action's docker env exports CONTENTRX_API_URL="" when the
    consumer doesn't set api-url — empty-string-as-missing is the case
    that 0.4.1 broke and 0.4.2 restores."""

    def test_missing_var_uses_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("CONTENTRX_API_URL", raising=False)
        assert cli._api_base_url() == cli.DEFAULT_API_URL

    def test_empty_string_uses_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # Reproduces the GitHub Action wiring: the action.yml input
        # default is '', the docker env carries it through as "", and
        # os.environ.get(name, default) does NOT honour `default` when
        # the var is present-but-empty.
        monkeypatch.setenv("CONTENTRX_API_URL", "")
        assert cli._api_base_url() == cli.DEFAULT_API_URL

    def test_https_value_returned_verbatim(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CONTENTRX_API_URL", "https://staging.example.com")
        assert cli._api_base_url() == "https://staging.example.com"

    def test_trailing_slash_stripped(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CONTENTRX_API_URL", "https://staging.example.com/")
        assert cli._api_base_url() == "https://staging.example.com"

    def test_http_without_opt_in_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CONTENTRX_API_URL", "http://localhost:3000")
        monkeypatch.delenv("CONTENTRX_INSECURE_HTTP", raising=False)
        with pytest.raises(CliError) as excinfo:
            cli._api_base_url()
        assert excinfo.value.code == EXIT_USAGE

    def test_http_with_insecure_opt_in_returns_url(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("CONTENTRX_API_URL", "http://localhost:3000")
        monkeypatch.setenv("CONTENTRX_INSECURE_HTTP", "1")
        assert cli._api_base_url() == "http://localhost:3000"
