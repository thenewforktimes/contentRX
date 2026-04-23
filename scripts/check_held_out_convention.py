#!/usr/bin/env python3
"""Enforce the `held-out-update:` commit-message convention.

Human-eval build plan Session 6 — approval ceremony for held-out
verdict changes. Any commit in a PR that modifies
`evals/held_out/manifest.json` or any file under `evals/industry/`
must use `held-out-update:` as its commit message prefix and include
a short reason.

This script is designed to run in a GitHub Actions PR workflow with
`fetch-depth: 0`. It reads the commit range from the environment and
exits non-zero if the convention is violated. It's also callable from
a local pre-push hook for the same check.

Usage:
    # In CI (bases the range on PR head vs merge base):
    python3 scripts/check_held_out_convention.py --base <sha> --head <sha>

    # Locally (compares HEAD vs origin/main):
    python3 scripts/check_held_out_convention.py
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys

HELD_OUT_PATHS = (
    "evals/held_out/manifest.json",
    "evals/industry/",
)

# Commit prefix regex. `held-out-update:` followed by at least one
# non-whitespace character (a reason) on the subject line.
PREFIX_RE = re.compile(r"^held-out-update:\s*\S.*$", re.MULTILINE)


def _git(args: list[str], cwd: str | None = None) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def commits_in_range(base: str, head: str) -> list[str]:
    """Return the list of commit SHAs from base..head, oldest first."""
    out = _git(["rev-list", "--reverse", f"{base}..{head}"])
    if not out:
        return []
    return out.splitlines()


def files_touched(sha: str) -> list[str]:
    """Return the list of paths modified by the given commit."""
    out = _git(["diff-tree", "--no-commit-id", "--name-only", "-r", sha])
    if not out:
        return []
    return out.splitlines()


def touches_held_out(paths: list[str]) -> bool:
    for path in paths:
        for needle in HELD_OUT_PATHS:
            if path == needle or path.startswith(needle):
                return True
    return False


def commit_message(sha: str) -> str:
    return _git(["log", "-1", "--format=%B", sha])


def has_valid_prefix(message: str) -> bool:
    """True when the first non-empty line starts with `held-out-update:`."""
    for line in message.splitlines():
        line = line.strip()
        if not line:
            continue
        return bool(PREFIX_RE.match(line))
    return False


def check(base: str, head: str) -> int:
    violations: list[tuple[str, str]] = []
    for sha in commits_in_range(base, head):
        files = files_touched(sha)
        if not touches_held_out(files):
            continue
        msg = commit_message(sha)
        if not has_valid_prefix(msg):
            subject = msg.splitlines()[0] if msg.splitlines() else "(empty)"
            violations.append((sha, subject))

    if not violations:
        print("held-out-update convention OK.")
        return 0

    print("::error ::held-out-update convention violated:", file=sys.stderr)
    for sha, subject in violations:
        print(
            f"  {sha[:10]}: modifies held-out data but subject is '{subject}'",
            file=sys.stderr,
        )
    print(
        "\nHeld-out verdict edits require Robo's approval. Prefix the "
        "commit subject with 'held-out-update:' and include a short reason. "
        "See docs/HELD_OUT_GATE.md.",
        file=sys.stderr,
    )
    return 1


def _default_base() -> str:
    """origin/main, falling back to the merge-base with origin/main."""
    try:
        return _git(["rev-parse", "origin/main"])
    except subprocess.CalledProcessError:
        return _git(["merge-base", "HEAD", "main"])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base",
        default=os.environ.get("HELD_OUT_BASE_SHA"),
        help="Base SHA; defaults to $HELD_OUT_BASE_SHA or origin/main.",
    )
    parser.add_argument(
        "--head",
        default=os.environ.get("HELD_OUT_HEAD_SHA") or "HEAD",
        help="Head SHA; defaults to $HELD_OUT_HEAD_SHA or HEAD.",
    )
    args = parser.parse_args(argv)

    base = args.base or _default_base()
    head = args.head
    return check(base, head)


if __name__ == "__main__":
    sys.exit(main())
