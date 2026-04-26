"""Tests for src/main.py orchestration — contentrx subprocess + reporting."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

import main as action_main


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    tsx = tmp_path / "src" / "Button.tsx"
    tsx.parent.mkdir(parents=True)
    tsx.write_text(
        '<button aria-label="Click here to learn more">Click here to learn more</button>\n',
        encoding="utf-8",
    )
    return tmp_path


@pytest.fixture
def event_file(tmp_path: Path) -> Path:
    # Minimal pull_request event payload.
    payload = {
        "pull_request": {"number": 42},
        "repository": {"full_name": "owner/repo"},
    }
    p = tmp_path / "event.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


def _violation_response(verdict: str = "fail") -> dict:
    return {
        "result": {
            "content_type": "button_cta",
            "overall_verdict": verdict,
            "violations": [
                {
                    "standard_id": "ACC-01",
                    "issue": "Avoid 'click here' link text.",
                    "suggestion": "Use descriptive link text.",
                }
            ]
            if verdict == "fail"
            else [],
            "summary": "Accessibility issue.",
        },
        "usage": {"used": 1, "quota": 25},
    }


def _pass_response() -> dict:
    return _violation_response(verdict="pass")


def test_main_posts_comment_when_violations_found(
    monkeypatch: pytest.MonkeyPatch,
    workspace: Path,
    event_file: Path,
    tmp_path: Path,
) -> None:
    output_file = tmp_path / "gha_output"
    monkeypatch.setenv("GITHUB_WORKSPACE", str(workspace))
    monkeypatch.setenv("GITHUB_EVENT_PATH", str(event_file))
    monkeypatch.setenv("GITHUB_OUTPUT", str(output_file))
    monkeypatch.setenv("GITHUB_TOKEN", "ghs_test_token")
    monkeypatch.setenv("CONTENTRX_API_KEY", "cx_test")
    monkeypatch.setenv("CONTENTRX_STRICT", "false")
    monkeypatch.setenv("CONTENTRX_PATHS", "**/*.tsx")
    monkeypatch.setenv("CONTENTRX_CONTENT_TYPE", "button_cta")

    # Force the changed-files fallback (full tree scan) so we don't hit GitHub.
    monkeypatch.setattr(action_main, "_fetch_changed_from_api", _raise)

    monkeypatch.setattr(
        action_main,
        "run_contentrx",
        lambda text, ct, fp: _violation_response(),
    )
    posted = {}

    def fake_post(body, repo, pull_number, token):
        posted.update(body=body, repo=repo, pull_number=pull_number, token=token)
        return {"id": 1}

    monkeypatch.setattr(action_main, "post_comment", fake_post)

    code = action_main.main()
    # v2 Session 10 — default fail-on is "violation" (was: don't fail
    # unless strict=true). Hard violations now fail the check by default;
    # workflows that want the v1 advisory-only behavior should set
    # `fail-on: none`.
    assert code == 1
    # Schema 2.0.0 — substrate IDs are stripped; the PR comment surfaces
    # the issue text instead of the standard_id badge.
    assert "ACC-01" not in posted["body"]
    assert posted["repo"] == "owner/repo"
    assert posted["pull_number"] == 42
    output = output_file.read_text()
    assert "violations=" in output
    assert "passed=false" in output


def test_fail_on_none_does_not_fail_on_violation(
    monkeypatch: pytest.MonkeyPatch,
    workspace: Path,
    event_file: Path,
    tmp_path: Path,
) -> None:
    """`fail-on: none` recovers the v1 advisory-only behavior."""
    output_file = tmp_path / "gha_output"
    monkeypatch.setenv("GITHUB_WORKSPACE", str(workspace))
    monkeypatch.setenv("GITHUB_EVENT_PATH", str(event_file))
    monkeypatch.setenv("GITHUB_OUTPUT", str(output_file))
    monkeypatch.setenv("GITHUB_TOKEN", "ghs_test_token")
    monkeypatch.setenv("CONTENTRX_API_KEY", "cx_test")
    monkeypatch.setenv("CONTENTRX_STRICT", "false")
    monkeypatch.setenv("CONTENTRX_FAIL_ON", "none")
    monkeypatch.setenv("CONTENTRX_PATHS", "**/*.tsx")
    monkeypatch.setattr(action_main, "_fetch_changed_from_api", _raise)
    monkeypatch.setattr(
        action_main, "run_contentrx",
        lambda text, ct, fp: _violation_response(),
    )
    monkeypatch.setattr(action_main, "post_comment", lambda *_a, **_kw: {"id": 1})

    code = action_main.main()
    assert code == 0
    output = output_file.read_text()
    assert "passed=true" in output


def test_fail_on_review_fails_when_review_recommended(
    monkeypatch: pytest.MonkeyPatch,
    workspace: Path,
    event_file: Path,
    tmp_path: Path,
) -> None:
    """`fail-on: review` fails on REVIEW-only results, not just violations."""
    def review_response(text: str, ct: str, fp: str) -> dict:
        return {
            "result": {
                "content_type": "button_cta",
                "overall_verdict": "fail",
                "verdict": "review_recommended",
                "review_reason": "low_confidence",
                "violations": [
                    {
                        "standard_id": "VT-01",
                        "issue": "Possibly passive voice.",
                        "suggestion": "Consider active voice.",
                        "confidence": 0.5,
                    }
                ],
                "summary": "Worth a second look.",
            },
            "usage": {"used": 1, "quota": 25},
        }

    output_file = tmp_path / "gha_output"
    monkeypatch.setenv("GITHUB_WORKSPACE", str(workspace))
    monkeypatch.setenv("GITHUB_EVENT_PATH", str(event_file))
    monkeypatch.setenv("GITHUB_OUTPUT", str(output_file))
    monkeypatch.setenv("GITHUB_TOKEN", "ghs_test_token")
    monkeypatch.setenv("CONTENTRX_API_KEY", "cx_test")
    monkeypatch.setenv("CONTENTRX_STRICT", "false")
    monkeypatch.setenv("CONTENTRX_FAIL_ON", "review")
    monkeypatch.setenv("CONTENTRX_PATHS", "**/*.tsx")
    monkeypatch.setattr(action_main, "_fetch_changed_from_api", _raise)
    monkeypatch.setattr(action_main, "run_contentrx", review_response)
    monkeypatch.setattr(action_main, "post_comment", lambda *_a, **_kw: {"id": 1})

    code = action_main.main()
    assert code == 1
    output = output_file.read_text()
    # Workspace fixture has multiple .tsx files; each maps to one review.
    assert "violations=0" in output
    assert "passed=false" in output
    # At least one review counted; exact number depends on the fixture.
    assert any(line.startswith("reviews=") and int(line.split("=")[1]) >= 1
               for line in output.splitlines())


def test_fail_on_violation_default_passes_on_review_only(
    monkeypatch: pytest.MonkeyPatch,
    workspace: Path,
    event_file: Path,
    tmp_path: Path,
) -> None:
    """Default fail-on=violation does NOT fail on review_recommended only."""
    def review_response(text: str, ct: str, fp: str) -> dict:
        return {
            "result": {
                "content_type": "button_cta",
                "overall_verdict": "fail",
                "verdict": "review_recommended",
                "violations": [
                    {"standard_id": "VT-01", "issue": "?", "suggestion": "?", "confidence": 0.5}
                ],
                "summary": "",
            },
            "usage": {"used": 1, "quota": 25},
        }

    output_file = tmp_path / "gha_output"
    monkeypatch.setenv("GITHUB_WORKSPACE", str(workspace))
    monkeypatch.setenv("GITHUB_EVENT_PATH", str(event_file))
    monkeypatch.setenv("GITHUB_OUTPUT", str(output_file))
    monkeypatch.setenv("GITHUB_TOKEN", "ghs_test_token")
    monkeypatch.setenv("CONTENTRX_API_KEY", "cx_test")
    monkeypatch.setenv("CONTENTRX_STRICT", "false")
    monkeypatch.setenv("CONTENTRX_PATHS", "**/*.tsx")
    monkeypatch.setattr(action_main, "_fetch_changed_from_api", _raise)
    monkeypatch.setattr(action_main, "run_contentrx", review_response)
    monkeypatch.setattr(action_main, "post_comment", lambda *_a, **_kw: {"id": 1})

    code = action_main.main()
    assert code == 0
    output = output_file.read_text()
    assert "violations=0" in output
    assert "passed=true" in output
    assert any(line.startswith("reviews=") and int(line.split("=")[1]) >= 1
               for line in output.splitlines())


def test_main_strict_mode_returns_nonzero_on_violations(
    monkeypatch: pytest.MonkeyPatch,
    workspace: Path,
    event_file: Path,
    tmp_path: Path,
) -> None:
    output_file = tmp_path / "gha_output"
    monkeypatch.setenv("GITHUB_WORKSPACE", str(workspace))
    monkeypatch.setenv("GITHUB_EVENT_PATH", str(event_file))
    monkeypatch.setenv("GITHUB_OUTPUT", str(output_file))
    monkeypatch.setenv("GITHUB_TOKEN", "ghs_test_token")
    monkeypatch.setenv("CONTENTRX_API_KEY", "cx_test")
    monkeypatch.setenv("CONTENTRX_STRICT", "true")
    monkeypatch.setenv("CONTENTRX_PATHS", "**/*.tsx")
    monkeypatch.setenv("CONTENTRX_CONTENT_TYPE", "button_cta")

    monkeypatch.setattr(action_main, "_fetch_changed_from_api", _raise)
    monkeypatch.setattr(
        action_main,
        "run_contentrx",
        lambda text, ct, fp: _violation_response(),
    )
    monkeypatch.setattr(action_main, "post_comment", lambda **_: None)

    code = action_main.main()
    assert code == 1


def test_main_returns_zero_when_all_pass(
    monkeypatch: pytest.MonkeyPatch,
    workspace: Path,
    event_file: Path,
    tmp_path: Path,
) -> None:
    output_file = tmp_path / "gha_output"
    monkeypatch.setenv("GITHUB_WORKSPACE", str(workspace))
    monkeypatch.setenv("GITHUB_EVENT_PATH", str(event_file))
    monkeypatch.setenv("GITHUB_OUTPUT", str(output_file))
    monkeypatch.setenv("GITHUB_TOKEN", "ghs_test_token")
    monkeypatch.setenv("CONTENTRX_API_KEY", "cx_test")
    monkeypatch.setenv("CONTENTRX_STRICT", "true")  # strict but no violations → still 0
    monkeypatch.setenv("CONTENTRX_PATHS", "**/*.tsx")
    monkeypatch.setenv("CONTENTRX_CONTENT_TYPE", "button_cta")

    monkeypatch.setattr(action_main, "_fetch_changed_from_api", _raise)
    monkeypatch.setattr(
        action_main,
        "run_contentrx",
        lambda text, ct, fp: _pass_response(),
    )
    monkeypatch.setattr(action_main, "post_comment", lambda **_: None)

    code = action_main.main()
    assert code == 0
    output = output_file.read_text()
    assert "passed=true" in output


def test_main_no_matching_files_is_noop(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    event_file: Path,
) -> None:
    # Workspace with only Python files → no TSX matches.
    (tmp_path / "foo.py").write_text("x = 1", encoding="utf-8")
    output_file = tmp_path / "gha_output"
    monkeypatch.setenv("GITHUB_WORKSPACE", str(tmp_path))
    monkeypatch.setenv("GITHUB_EVENT_PATH", str(event_file))
    monkeypatch.setenv("GITHUB_OUTPUT", str(output_file))
    monkeypatch.setenv("CONTENTRX_API_KEY", "cx_test")
    monkeypatch.setenv("CONTENTRX_PATHS", "**/*.tsx")
    monkeypatch.setenv("CONTENTRX_STRICT", "false")
    monkeypatch.setenv("CONTENTRX_CONTENT_TYPE", "button_cta")

    monkeypatch.setattr(action_main, "_fetch_changed_from_api", _raise)
    monkeypatch.setattr(
        action_main,
        "run_contentrx",
        lambda text, ct, fp: pytest.fail("should not be called"),
    )

    code = action_main.main()
    assert code == 0
    output = output_file.read_text()
    assert "violations=0" in output
    assert "passed=true" in output


def _raise(*a, **kw):
    raise RuntimeError("forced fallback to tree scan")
