"""Tests for scripts/check_taxonomy_changelog.py.

Human-eval build plan Session 23. Exercises the regexes and the range
resolution logic; full git-diff integration is smoke-tested by the
workflow running on a real PR. The script is intentionally simple —
regex matches on the unified-diff format — so these tests pin the
format contract more than the implementation.
"""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "scripts" / "check_taxonomy_changelog.py"


def _load_module():
    spec = importlib.util.spec_from_file_location(
        "check_taxonomy_changelog", SCRIPT_PATH
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def script():
    return _load_module()


def test_touches_taxonomy_true_for_library(script) -> None:
    assert script.touches_taxonomy({
        "src/content_checker/standards/private/standards_library.json",
        "README.md",
    })


def test_touches_taxonomy_true_for_moments_py(script) -> None:
    assert script.touches_taxonomy({"src/content_checker/moments.py"})


def test_touches_taxonomy_false_for_unrelated(script) -> None:
    assert not script.touches_taxonomy({
        "src/app/page.tsx",
        "README.md",
    })


def test_version_history_added_matches_unified_diff_prefix(script) -> None:
    """The diff lines the script scans for are additions on the
    standards library that introduce a new `change_note` field.
    """
    added = '+          "change_note": "Ship Session 23 changelog."'
    unrelated = '+          "rule": "Use plain language."'
    assert script.VERSION_HISTORY_ADDED_RE.match(added)
    assert not script.VERSION_HISTORY_ADDED_RE.match(unrelated)


def test_approved_refinement_added_matches_ref_header(script) -> None:
    added = "+### REF-004: ui_label → section_header"
    similar = "+ ### REF-005:" # leading space — still valid-ish but rejected
    unrelated = "+## Approved refinements"
    assert script.APPROVED_REFINEMENT_ADDED_RE.match(added)
    # The regex anchors at `+###` with no intervening space; permissive
    # matching would false-positive on `+ ### ...` which can appear in
    # unrelated diffs.
    assert not script.APPROVED_REFINEMENT_ADDED_RE.match(similar)
    assert not script.APPROVED_REFINEMENT_ADDED_RE.match(unrelated)


def test_skip_prefix_regex_accepts_commit_body(script) -> None:
    body = """\
some prior line
changelog-skip: ESLint autofix, no taxonomic effect.
another line
"""
    assert script.SKIP_PREFIX_RE.search(body)


def test_skip_prefix_regex_rejects_missing_reason(script) -> None:
    body = "changelog-skip:\n"
    assert not script.SKIP_PREFIX_RE.search(body)


def test_skip_prefix_regex_rejects_other_prefixes(script) -> None:
    body = "skip-changelog: oops wrong direction\n"
    assert not script.SKIP_PREFIX_RE.search(body)


def test_resolve_range_reads_github_env(script, monkeypatch) -> None:
    monkeypatch.setenv("GITHUB_BASE_SHA", "abc123")
    monkeypatch.setenv("GITHUB_HEAD_SHA", "def456")
    # argparse.Namespace with attrs only — script.main builds its own.
    ns = script.argparse.Namespace(base=None, head=None)
    base, head = script.resolve_range(ns)
    assert base == "abc123"
    assert head == "def456"


def test_resolve_range_prefers_explicit_flags(script, monkeypatch) -> None:
    monkeypatch.setenv("GITHUB_BASE_SHA", "env-base")
    ns = script.argparse.Namespace(base="flag-base", head="flag-head")
    base, head = script.resolve_range(ns)
    assert base == "flag-base"
    assert head == "flag-head"


def test_resolve_range_exits_when_base_missing(script, monkeypatch) -> None:
    monkeypatch.delenv("GITHUB_BASE_SHA", raising=False)
    monkeypatch.delenv("TAXONOMY_BASE_SHA", raising=False)
    ns = script.argparse.Namespace(base=None, head=None)
    with pytest.raises(SystemExit) as excinfo:
        script.resolve_range(ns)
    assert excinfo.value.code == 2


def test_taxonomy_file_paths_exist(script) -> None:
    """The paths the guard watches must actually exist. Catches a
    silent rename of the standards library or moments file.
    """
    for path in script.TAXONOMY_FILES:
        assert (REPO_ROOT / path).exists(), (
            f"TAXONOMY_FILES references {path!r}, which does not exist. "
            "If the file was renamed, update scripts/check_taxonomy_changelog.py."
        )
