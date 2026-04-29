#!/usr/bin/env python3
"""CI guard: require a changelog entry when taxonomy files change.

Human-eval build plan Session 23. Enforces the plan's acceptance
criterion: "CI step that requires a changelog entry when a standards
file or moment taxonomy changes."

Rule: any PR that modifies one of the taxonomy files must also EITHER
  - append a new `version_history` entry somewhere in
    `standards_library.json`, OR
  - add a new `### REF-NNN` entry under the `## Approved refinements`
    heading of `taxonomy_refinement_log.md`, OR
  - mark a commit in the PR with a `changelog-skip:` prefix so
    reviewers see the author explicitly opted out (formatting-only,
    reverts, CI tweaks).

The guard reads the PR's base + head SHAs from the environment the
same way `scripts/check_held_out_convention.py` does. Locally, pass
`--base origin/main` and `--head HEAD` explicitly.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys

TAXONOMY_FILES = (
    "src/content_checker/standards/private/standards_library.json",
    "src/content_checker/standards/private/moments_taxonomy.json",
    "src/content_checker/moments.py",
)

CHANGELOG_FILES = (
    "src/content_checker/standards/private/standards_library.json",
    "taxonomy_refinement_log.md",
)

# A new version_history entry in the standards library looks like:
#     +          "change_note": "..."
# `git diff` output prefixes added lines with `+`; we match on the JSON
# field key rather than full lines so formatting flexibility doesn't
# break the check.
VERSION_HISTORY_ADDED_RE = re.compile(r'^\+\s*"change_note"\s*:')

# A new approved refinement adds a `### REF-NNN` line under the
# Approved section. We don't gate on the section position — reviewers
# will catch a mis-placed entry — but we do require the REF identifier
# to pass the regex.
APPROVED_REFINEMENT_ADDED_RE = re.compile(r"^\+###\s+REF-\d+")

# Opt-out prefix on a commit subject line. Mirrors the
# `held-out-update:` convention (Session 6): the author types it, CI
# surfaces it on the PR, reviewers see it.
SKIP_PREFIX_RE = re.compile(r"^changelog-skip:\s*\S.*$", re.MULTILINE)


def _git(args: list[str]) -> str:
    result = subprocess.run(
        ["git", *args],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


def changed_files(base: str, head: str) -> set[str]:
    out = _git(["diff", "--name-only", f"{base}...{head}"])
    return {ln for ln in out.splitlines() if ln}


def touches_taxonomy(files: set[str]) -> bool:
    return any(f in TAXONOMY_FILES for f in files)


def added_changelog_entry(base: str, head: str) -> bool:
    """True if the diff adds at least one changelog-eligible line."""
    diff = _git(["diff", f"{base}...{head}", "--", *CHANGELOG_FILES])
    for line in diff.splitlines():
        if VERSION_HISTORY_ADDED_RE.match(line):
            return True
        if APPROVED_REFINEMENT_ADDED_RE.match(line):
            return True
    return False


def has_skip_marker(base: str, head: str) -> bool:
    out = _git(["log", "--format=%B", f"{base}..{head}"])
    return bool(SKIP_PREFIX_RE.search(out))


def resolve_range(args: argparse.Namespace) -> tuple[str, str]:
    base = (
        args.base
        or os.environ.get("TAXONOMY_BASE_SHA")
        or os.environ.get("GITHUB_BASE_SHA")
    )
    head = (
        args.head
        or os.environ.get("TAXONOMY_HEAD_SHA")
        or os.environ.get("GITHUB_HEAD_SHA")
        or "HEAD"
    )
    if not base:
        print(
            "No base SHA provided. Pass --base <sha>, or set TAXONOMY_BASE_SHA / "
            "GITHUB_BASE_SHA in the environment.",
            file=sys.stderr,
        )
        sys.exit(2)
    return base, head


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", help="Base git ref / SHA")
    parser.add_argument("--head", help="Head git ref / SHA")
    args = parser.parse_args()
    base, head = resolve_range(args)

    files = changed_files(base, head)
    if not touches_taxonomy(files):
        print("No taxonomy files changed in base..head — skipping.")
        return 0

    if has_skip_marker(base, head):
        print("`changelog-skip:` marker present on a commit — allowing.")
        return 0

    if added_changelog_entry(base, head):
        print("Taxonomy change detected and a matching changelog entry was added.")
        return 0

    print(
        "ERROR: taxonomy files changed but no changelog entry was added.\n"
        "\n"
        "Fix by either:\n"
        "  - bumping `version` on the standard whose rule text or\n"
        "    metadata changed and appending a `version_history` entry, OR\n"
        "  - adding a `### REF-NNN` entry under the\n"
        "    `## Approved refinements` header of `taxonomy_refinement_log.md`, OR\n"
        "  - prefixing one of your commit messages with `changelog-skip:`\n"
        "    (formatting-only changes, reverts, CI tweaks).\n"
        "\n"
        "The `/model/changelog` page on docs.contentrx.io reads these\n"
        "entries verbatim. An unchronicled taxonomy change breaks the\n"
        "transparency commitment to users.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
