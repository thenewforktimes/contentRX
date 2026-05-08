"""Tests for the held-out commit-message convention checker.

Human-eval build plan Session 6. Covers the pure logic in
`scripts/check_held_out_convention.py` (path matching + prefix
regex + has-valid-prefix rules) plus an end-to-end check against a
temporary git repo that exercises the full walk-commits-in-range
flow without requiring a real GitHub PR.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

# The checker lives under `scripts/`, which isn't a package. Add it to
# sys.path so it can be imported.
SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import check_held_out_convention as checker  # noqa: E402


# ---------------------------------------------------------------------------
# Pure-logic tests
# ---------------------------------------------------------------------------


class TestTouchesHeldOut:
    def test_manifest_path(self):
        assert checker.touches_held_out(["evals/held_out/manifest.json"])

    def test_industry_corpus_file(self):
        assert checker.touches_held_out(["evals/industry/sample_eval_cases.json"])

    def test_industry_dir_prefix(self):
        assert checker.touches_held_out(["evals/industry/nested/deep.json"])

    def test_unrelated_file(self):
        assert not checker.touches_held_out(["src/content_checker/pipeline.py"])
        assert not checker.touches_held_out(["evals/novel_cases.json"])
        assert not checker.touches_held_out(["evals/held_out/README.md"])

    def test_mixed_with_unrelated(self):
        assert checker.touches_held_out(
            ["src/foo.py", "evals/held_out/manifest.json", "README.md"]
        )

    def test_empty_list(self):
        assert not checker.touches_held_out([])


class TestHasValidPrefix:
    def test_simple_pass(self):
        assert checker.has_valid_prefix("held-out-update: revise apple-042")

    def test_with_body_paragraph(self):
        msg = (
            "held-out-update: revise apple-042 after second review\n"
            "\n"
            "Long body explaining why the verdict changed.\n"
        )
        assert checker.has_valid_prefix(msg)

    def test_leading_blank_line_tolerated(self):
        assert checker.has_valid_prefix("\n\nheld-out-update: refreshed")

    def test_no_prefix_fails(self):
        assert not checker.has_valid_prefix("fix: update manifest")

    def test_wrong_prefix_fails(self):
        assert not checker.has_valid_prefix("chore(eval): bump manifest")

    def test_prefix_without_reason_fails(self):
        assert not checker.has_valid_prefix("held-out-update:")
        assert not checker.has_valid_prefix("held-out-update:   ")

    def test_prefix_not_at_start_of_subject_fails(self):
        # Body-line match should NOT count — it's the subject that matters.
        msg = (
            "fix: update manifest\n"
            "\n"
            "held-out-update: this isn't the subject line\n"
        )
        assert not checker.has_valid_prefix(msg)

    def test_empty_message_fails(self):
        assert not checker.has_valid_prefix("")
        assert not checker.has_valid_prefix("\n\n\n")


# ---------------------------------------------------------------------------
# End-to-end: run against a throwaway git repo
# ---------------------------------------------------------------------------


def _init_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _run(["git", "init", "-q", "-b", "main"], cwd=repo)
    _run(["git", "config", "user.email", "test@example.com"], cwd=repo)
    _run(["git", "config", "user.name", "Test"], cwd=repo)
    _run(["git", "config", "commit.gpgsign", "false"], cwd=repo)
    return repo


def _run(args: list[str], cwd: Path) -> str:
    result = subprocess.run(
        args, cwd=cwd, capture_output=True, text=True, check=True,
    )
    return result.stdout


def _commit(repo: Path, path: str, content: str, subject: str) -> str:
    full = repo / path
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(content)
    _run(["git", "add", path], cwd=repo)
    _run(["git", "commit", "-q", "-m", subject], cwd=repo)
    return _run(["git", "rev-parse", "HEAD"], cwd=repo).strip()


def _initial_unrelated_commit(repo: Path) -> str:
    return _commit(repo, "README.md", "hello", "chore: initial")


class TestCheckEndToEnd:
    def test_no_held_out_touches_passes(self, tmp_path, capsys):
        repo = _init_repo(tmp_path)
        base = _initial_unrelated_commit(repo)
        head = _commit(repo, "src/foo.py", "print('hi')", "feat: add foo")
        with _cwd(repo):
            assert checker.check(base, head) == 0

    def test_held_out_commit_with_valid_prefix_passes(self, tmp_path, capsys):
        repo = _init_repo(tmp_path)
        base = _initial_unrelated_commit(repo)
        head = _commit(
            repo,
            "evals/held_out/manifest.json",
            "{}",
            "held-out-update: refresh after annotation pass",
        )
        with _cwd(repo):
            assert checker.check(base, head) == 0

    def test_held_out_commit_without_prefix_fails(self, tmp_path, capsys):
        repo = _init_repo(tmp_path)
        base = _initial_unrelated_commit(repo)
        head = _commit(
            repo,
            "evals/held_out/manifest.json",
            "{}",
            "fix: update manifest",
        )
        with _cwd(repo):
            assert checker.check(base, head) == 1
        err = capsys.readouterr().err
        assert "held-out-update convention violated" in err

    def test_industry_dir_touch_also_requires_prefix(self, tmp_path, capsys):
        repo = _init_repo(tmp_path)
        base = _initial_unrelated_commit(repo)
        head = _commit(
            repo,
            "evals/industry/apple.json",
            "[]",
            "chore: sync apple",
        )
        with _cwd(repo):
            assert checker.check(base, head) == 1

    def test_mixed_range_flags_only_violating_commits(self, tmp_path, capsys):
        repo = _init_repo(tmp_path)
        base = _initial_unrelated_commit(repo)
        # Good commit — unrelated change, no prefix needed.
        _commit(repo, "src/foo.py", "a", "feat: add foo")
        # Good commit — held-out change with valid prefix.
        _commit(
            repo,
            "evals/held_out/manifest.json",
            "[]",
            "held-out-update: refresh",
        )
        # Bad commit — held-out change without prefix.
        head = _commit(
            repo,
            "evals/held_out/manifest.json",
            "[1]",
            "chore: drift",
        )
        with _cwd(repo):
            assert checker.check(base, head) == 1
        err = capsys.readouterr().err
        # Only the third commit should be flagged.
        assert err.count("modifies held-out data") == 1

    def test_empty_range_passes(self, tmp_path):
        repo = _init_repo(tmp_path)
        sha = _initial_unrelated_commit(repo)
        with _cwd(repo):
            assert checker.check(sha, sha) == 0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _cwd:
    def __init__(self, path: Path):
        self.path = path
        self._prev: str | None = None

    def __enter__(self):
        self._prev = os.getcwd()
        os.chdir(self.path)
        return self

    def __exit__(self, *_):
        if self._prev is not None:
            os.chdir(self._prev)
