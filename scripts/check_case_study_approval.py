#!/usr/bin/env python3
"""CI guard for the OSS case-study registry.

Human-eval build plan Sessions 26–28 acceptance criterion: every
published case study requires explicit maintainer approval. This
script parses `docs-site/lib/case-studies.ts` and ensures that every
entry in `CASE_STUDIES`:

  - carries `maintainer_approval: true` (the exact-true requirement
    in the TypeScript type is not enough; we check the literal
    source so a TypeScript `as any` cast can't slip something past);
  - names `approved_by` with a non-empty string;
  - carries an `approved_at` ISO-8601 date;
  - lists at least three `judgment_calls`.

The parser is a narrow regex sweep over the TypeScript source, not
a full TS parser — the registry is a deliberately simple
hand-maintained array. If the TypeScript shape changes, this script
fails loud and the reviewer updates both.

Also checks that every `slug` in the registry has a matching folder
under `docs-site/app/case-studies/<slug>/` so the registry can't
drift from the content.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
REGISTRY_PATH = REPO_ROOT / "docs-site" / "lib" / "case-studies.ts"
CASE_STUDIES_DIR = REPO_ROOT / "docs-site" / "app" / "case-studies"

# Matches an entire CaseStudyMeta literal inside the `CASE_STUDIES = [ ... ]`
# array. Matches the outer `{ ... }` greedily on the balanced-braces
# assumption — fine for hand-authored registry entries which don't
# nest objects arbitrarily.
_ENTRY_RE = re.compile(
    r"(?P<body>\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})",
    re.DOTALL,
)

_SLUG_RE = re.compile(r"slug:\s*[\"'](?P<slug>[^\"']+)[\"']")
_MAINTAINER_APPROVAL_RE = re.compile(r"maintainer_approval:\s*true\b")
_APPROVED_BY_RE = re.compile(r"approved_by:\s*[\"'](?P<approved_by>[^\"']+)[\"']")
_APPROVED_AT_RE = re.compile(r"approved_at:\s*[\"'](?P<approved_at>\d{4}-\d{2}-\d{2})[\"']")
_JUDGMENT_CALL_COUNT_RE = re.compile(r"summary:\s*[\"']")


def extract_registry_block(source: str) -> str:
    """Return the content of `CASE_STUDIES = [ ... ]`, brackets
    excluded. Raises if the literal assignment is missing.
    """
    anchor = source.find("CASE_STUDIES")
    if anchor < 0:
        raise RuntimeError(
            "Couldn't find `CASE_STUDIES` in docs-site/lib/case-studies.ts. "
            "Did the registry get renamed?"
        )
    bracket_start = source.find("[", anchor)
    if bracket_start < 0:
        raise RuntimeError(
            "Couldn't find the opening `[` of the CASE_STUDIES array."
        )
    depth = 0
    for i in range(bracket_start, len(source)):
        if source[i] == "[":
            depth += 1
        elif source[i] == "]":
            depth -= 1
            if depth == 0:
                return source[bracket_start + 1 : i]
    raise RuntimeError("Unbalanced brackets in CASE_STUDIES array literal.")


def split_entries(block: str) -> list[str]:
    """Split a registry-array body into per-entry `{ … }` substrings."""
    entries: list[str] = []
    depth = 0
    start: int | None = None
    for i, ch in enumerate(block):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start is not None:
                entries.append(block[start : i + 1])
                start = None
    return entries


def check_entry(entry: str) -> list[str]:
    errors: list[str] = []
    slug_match = _SLUG_RE.search(entry)
    slug = slug_match.group("slug") if slug_match else "<missing-slug>"

    if not _MAINTAINER_APPROVAL_RE.search(entry):
        errors.append(
            f"{slug}: `maintainer_approval: true` is missing or not the literal boolean."
        )

    if not _APPROVED_BY_RE.search(entry):
        errors.append(f"{slug}: `approved_by` is missing or not a string.")

    approved_at_match = _APPROVED_AT_RE.search(entry)
    if not approved_at_match:
        errors.append(
            f"{slug}: `approved_at` is missing or not an ISO YYYY-MM-DD date."
        )

    judgment_call_count = len(_JUDGMENT_CALL_COUNT_RE.findall(entry))
    if judgment_call_count < 3:
        errors.append(
            f"{slug}: needs at least 3 judgment_calls (found {judgment_call_count})."
        )

    if slug and slug != "<missing-slug>":
        folder = CASE_STUDIES_DIR / slug
        mdx_page = folder / "page.mdx"
        tsx_page = folder / "page.tsx"
        if not folder.exists():
            errors.append(
                f"{slug}: no folder at docs-site/app/case-studies/{slug}/ — "
                "registry points at a route that doesn't exist."
            )
        elif not mdx_page.exists() and not tsx_page.exists():
            errors.append(
                f"{slug}: docs-site/app/case-studies/{slug}/ exists but has no page.mdx or page.tsx."
            )

    return errors


def main() -> int:
    if not REGISTRY_PATH.exists():
        print(
            f"ERROR: {REGISTRY_PATH} does not exist. Did the scaffolding revert?",
            file=sys.stderr,
        )
        return 1

    source = REGISTRY_PATH.read_text(encoding="utf-8")
    block = extract_registry_block(source)
    entries = split_entries(block)

    if not entries:
        # Empty registry is valid — scaffolding state. The guard has
        # nothing to check but we still want to confirm the registry
        # lib is syntactically recognisable.
        print(
            "Case-study registry is empty — scaffolding state. "
            "Nothing to enforce.",
        )
        return 0

    all_errors: list[str] = []
    for entry in entries:
        all_errors.extend(check_entry(entry))

    if all_errors:
        print(
            "Case-study registry failed approval check. Every published "
            "study needs `maintainer_approval: true`, `approved_by`, "
            "`approved_at`, three judgment calls, and a matching "
            "docs-site/app/case-studies/<slug>/ folder.\n",
            file=sys.stderr,
        )
        for err in all_errors:
            print(f"  - {err}", file=sys.stderr)
        print(
            "\nSee docs-site/content/case-studies/README.md for the "
            "publishing workflow.",
            file=sys.stderr,
        )
        return 1

    print(f"Case-study registry OK — {len(entries)} entry(ies) validated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
