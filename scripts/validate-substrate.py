#!/usr/bin/env python3
"""Validate the private substrate before it can break public CI.

The substrate (`contentRX-substrate` private repo, mounted at
`src/content_checker/standards/private/`) is three JSON files Robert
hand-maintains. A typo or duplicate ID here breaks every Vercel deploy
+ every public-CI run. This script catches the breakage class BEFORE
it lands by enforcing:

  1. JSON syntax (each of the 3 files parses).
  2. Required top-level keys exist + have the right types.
  3. Unique standard IDs across all categories.
  4. Unique content_type IDs.
  5. Unique moment IDs.
  6. Every standard has the engine-required fields (id, rule, correct,
     incorrect).
  7. `standards_library.total_standards` matches the actual count.
  8. `moments_taxonomy.total_moments` matches the actual count.
  9. Every standard_id referenced in `moments_taxonomy.moments[].weights`
     exists in `standards_library.categories[].standards[]`.
  10. Every standard_id in `ui_specific_standards.standards[]` exists in
      `standards_library.categories[].standards[]`.

How it's wired:

  - Public CI calls this as a guard before running the substrate-aware
    pytest suite — see `.github/workflows/substrate-changed.yml`.
  - Robert can run it locally before a substrate commit:
    `python3 scripts/validate-substrate.py`
  - The substrate repo's own GHA workflow can also call it via a
    public-repo checkout — see `docs/substrate-repo-setup.md`.

Exits 0 on a clean validate (with a one-line OK summary), 1 on any
failure (with specific `<file>: <message>` lines so the founder can
fix the typo without grepping).

Importable: tests in `tests/test_validate_substrate.py` exercise the
pure-function `validate(...)` against synthetic fixtures so the
validator itself doesn't drift.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
SUBSTRATE_DIR = REPO_ROOT / "src" / "content_checker" / "standards" / "private"

STANDARDS_FILE = SUBSTRATE_DIR / "standards_library.json"
MOMENTS_FILE = SUBSTRATE_DIR / "moments_taxonomy.json"
UI_SPECIFIC_FILE = SUBSTRATE_DIR / "ui_specific_standards.json"

# Engine-required fields per standard. The engine's loader + LLM prompt
# builder will fail at runtime without these. Adding to this list is a
# breaking change — every standard must then have the new field.
STANDARD_REQUIRED_FIELDS = ("id", "rule", "correct", "incorrect")

# Standard-ID shape, e.g. "GRM-01", "ACC-08", "TEAM-99".
_STANDARD_ID_RE = re.compile(r"^[A-Z]{2,4}-\d{2,3}$")

# Semver-ish: M.m.p with optional pre-release tag.
_SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$")


@dataclass
class ValidationResult:
    """Validator output.

    `errors` block CI and ship-deploys — JSON parse failures, missing
    required fields, duplicate IDs, total_standards mismatches.

    `warnings` are real drift signals but don't block. Today's only
    warning class is "orphan reference" — a standard_id mentioned in
    ui_specific or moments_taxonomy that doesn't exist in
    standards_library. The engine tolerates these (the orphaned
    reference is functionally inert because no rule definition
    matches the id), so they don't fail deploys, but Robert should
    see them and clean up. Promoting these to errors later is one
    line; for now keep them advisory so a stale reference doesn't
    break every deploy until the substrate is cleaned.
    """

    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    summary: dict[str, int] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.errors


def _load_json(path: Path) -> tuple[Any, str | None]:
    """Returns (data, error). On JSON parse failure: (None, error_str)."""
    if not path.exists():
        return None, f"{path}: file does not exist"
    try:
        return json.loads(path.read_text(encoding="utf-8")), None
    except json.JSONDecodeError as e:
        return None, f"{path}: invalid JSON — {e.msg} at line {e.lineno} col {e.colno}"


def validate(
    standards: dict[str, Any] | None,
    moments: dict[str, Any] | None,
    ui_specific: dict[str, Any] | None,
) -> ValidationResult:
    """Pure validation. Importable for tests."""
    result = ValidationResult()

    # ── standards_library.json ──────────────────────────────────────────
    standard_ids: set[str] = set()
    if standards is None:
        result.errors.append(f"{STANDARDS_FILE.name}: missing or unparseable")
    else:
        if not isinstance(standards.get("version"), str) or not _SEMVER_RE.match(
            standards["version"]
        ):
            result.errors.append(
                f"{STANDARDS_FILE.name}: `version` must be a semver string"
            )
        categories = standards.get("categories")
        if not isinstance(categories, list):
            result.errors.append(
                f"{STANDARDS_FILE.name}: `categories` must be a list"
            )
            categories = []
        for cat_i, cat in enumerate(categories):
            if not isinstance(cat, dict):
                result.errors.append(
                    f"{STANDARDS_FILE.name}: categories[{cat_i}] is not an object"
                )
                continue
            cat_standards = cat.get("standards", [])
            if not isinstance(cat_standards, list):
                result.errors.append(
                    f"{STANDARDS_FILE.name}: categories[{cat_i}].standards is not a list"
                )
                continue
            for std_i, std in enumerate(cat_standards):
                if not isinstance(std, dict):
                    result.errors.append(
                        f"{STANDARDS_FILE.name}: categories[{cat_i}].standards[{std_i}] is not an object"
                    )
                    continue
                std_id = std.get("id")
                if not isinstance(std_id, str) or not _STANDARD_ID_RE.match(std_id):
                    result.errors.append(
                        f"{STANDARDS_FILE.name}: categories[{cat_i}].standards[{std_i}] id "
                        f"{std_id!r} must match /^[A-Z]{{2,4}}-\\d{{2,3}}$/"
                    )
                    continue
                if std_id in standard_ids:
                    result.errors.append(
                        f"{STANDARDS_FILE.name}: duplicate standard id {std_id!r}"
                    )
                standard_ids.add(std_id)
                for required in STANDARD_REQUIRED_FIELDS:
                    if not std.get(required):
                        result.errors.append(
                            f"{STANDARDS_FILE.name}: standard {std_id!r} is missing "
                            f"required field {required!r}"
                        )

        # total_standards check (cross-references the catalog count).
        if isinstance(standards.get("total_standards"), int):
            if standards["total_standards"] != len(standard_ids):
                result.errors.append(
                    f"{STANDARDS_FILE.name}: `total_standards` says "
                    f"{standards['total_standards']} but found {len(standard_ids)} "
                    f"unique standard ids"
                )

        # content_types uniqueness.
        content_type_ids: set[str] = set()
        content_types = standards.get("content_types", [])
        if isinstance(content_types, list):
            for ct_i, ct in enumerate(content_types):
                if not isinstance(ct, dict):
                    continue
                ct_id = ct.get("id")
                if not isinstance(ct_id, str):
                    result.errors.append(
                        f"{STANDARDS_FILE.name}: content_types[{ct_i}].id is not a string"
                    )
                    continue
                if ct_id in content_type_ids:
                    result.errors.append(
                        f"{STANDARDS_FILE.name}: duplicate content_type id {ct_id!r}"
                    )
                content_type_ids.add(ct_id)
        result.summary["content_types"] = len(content_type_ids)

    result.summary["standards"] = len(standard_ids)

    # ── moments_taxonomy.json ──────────────────────────────────────────
    moment_ids: set[str] = set()
    moment_weight_refs: set[str] = set()
    if moments is None:
        result.errors.append(f"{MOMENTS_FILE.name}: missing or unparseable")
    else:
        moment_list = moments.get("moments", [])
        if not isinstance(moment_list, list):
            result.errors.append(
                f"{MOMENTS_FILE.name}: `moments` must be a list"
            )
            moment_list = []
        for m_i, m in enumerate(moment_list):
            if not isinstance(m, dict):
                result.errors.append(
                    f"{MOMENTS_FILE.name}: moments[{m_i}] is not an object"
                )
                continue
            m_id = m.get("id")
            if not isinstance(m_id, str):
                result.errors.append(
                    f"{MOMENTS_FILE.name}: moments[{m_i}].id is not a string"
                )
                continue
            if m_id in moment_ids:
                result.errors.append(
                    f"{MOMENTS_FILE.name}: duplicate moment id {m_id!r}"
                )
            moment_ids.add(m_id)
            # Track every standard id mentioned in `weights` so we can
            # cross-check it exists in standards_library.json below.
            weights = m.get("weights", {})
            if isinstance(weights, dict):
                for w_key in weights:
                    if isinstance(w_key, str) and _STANDARD_ID_RE.match(w_key):
                        moment_weight_refs.add(w_key)

        # total_moments check.
        if isinstance(moments.get("total_moments"), int):
            if moments["total_moments"] != len(moment_ids):
                result.errors.append(
                    f"{MOMENTS_FILE.name}: `total_moments` says "
                    f"{moments['total_moments']} but found {len(moment_ids)} "
                    f"unique moment ids"
                )

    result.summary["moments"] = len(moment_ids)

    # Cross-file: moment weights must reference real standards.
    # Orphans are warnings (engine tolerates them) — see ValidationResult docstring.
    if standard_ids and moment_weight_refs:
        orphan_refs = moment_weight_refs - standard_ids
        if orphan_refs:
            result.warnings.append(
                f"{MOMENTS_FILE.name}: weights reference standard ids that don't "
                f"exist in {STANDARDS_FILE.name}: {sorted(orphan_refs)}"
            )

    # ── ui_specific_standards.json ────────────────────────────────────
    ui_specific_ids: set[str] = set()
    if ui_specific is None:
        result.errors.append(f"{UI_SPECIFIC_FILE.name}: missing or unparseable")
    else:
        ui_standards = ui_specific.get("standards", [])
        if not isinstance(ui_standards, list):
            result.errors.append(
                f"{UI_SPECIFIC_FILE.name}: `standards` must be a list"
            )
            ui_standards = []
        for u_i, u in enumerate(ui_standards):
            if not isinstance(u, dict):
                continue
            u_id = u.get("id")
            if not isinstance(u_id, str):
                result.errors.append(
                    f"{UI_SPECIFIC_FILE.name}: standards[{u_i}].id is not a string"
                )
                continue
            ui_specific_ids.add(u_id)

    # Cross-file: ui_specific ids must reference real standards.
    # Orphans are warnings — see ValidationResult docstring.
    if standard_ids and ui_specific_ids:
        orphan_ui_refs = ui_specific_ids - standard_ids
        if orphan_ui_refs:
            result.warnings.append(
                f"{UI_SPECIFIC_FILE.name}: standards reference ids that don't exist "
                f"in {STANDARDS_FILE.name}: {sorted(orphan_ui_refs)}"
            )

    result.summary["ui_specific"] = len(ui_specific_ids)
    return result


def main() -> int:
    standards, err1 = _load_json(STANDARDS_FILE)
    moments, err2 = _load_json(MOMENTS_FILE)
    ui_specific, err3 = _load_json(UI_SPECIFIC_FILE)

    parse_errors = [e for e in (err1, err2, err3) if e]
    for e in parse_errors:
        print(f"[validate-substrate] ERROR: {e}", file=sys.stderr)
    if parse_errors and not (standards and moments and ui_specific):
        # If any file failed to parse, don't try semantic validation
        # against partial data — the JSON-lint output is already what
        # the caller needs to fix first.
        print("[validate-substrate] FAILED: fix the JSON parse errors above first.", file=sys.stderr)
        return 1

    result = validate(standards, moments, ui_specific)

    if not result.ok:
        print("[validate-substrate] FAILED with the following errors:", file=sys.stderr)
        for e in result.errors:
            print(f"  - {e}", file=sys.stderr)
        if result.warnings:
            print("[validate-substrate] Also warning:", file=sys.stderr)
            for w in result.warnings:
                print(f"  - {w}", file=sys.stderr)
        return 1

    # Warnings surface but don't fail.
    for w in result.warnings:
        print(f"[validate-substrate] WARNING: {w}", file=sys.stderr)

    s = result.summary
    suffix = (
        " ⚠️  See warnings above." if result.warnings else " No drift detected."
    )
    print(
        f"[validate-substrate] OK — {s.get('standards', 0)} standards, "
        f"{s.get('content_types', 0)} content_types, "
        f"{s.get('moments', 0)} moments, "
        f"{s.get('ui_specific', 0)} ui-specific entries.{suffix}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
